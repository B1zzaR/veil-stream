package handlers

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	ffmpegworker "veil/internal/ffmpeg"
	"veil/internal/models"
	"veil/internal/ws"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
)

// writeBufSize is the bufio writer size for streaming uploads to disk.
// 4 MB keeps syscall count low while not wasting much memory per concurrent upload.
const writeBufSize = 4 * 1024 * 1024

type VideoHandler struct {
	db        *sqlx.DB
	hub       *ws.Hub
	mediaPath string
	probes    *ProbeQueue
}

func NewVideoHandler(db *sqlx.DB, hub *ws.Hub, mediaPath string, probes *ProbeQueue) *VideoHandler {
	return &VideoHandler{db: db, hub: hub, mediaPath: mediaPath, probes: probes}
}

func (h *VideoHandler) List(c *fiber.Ctx) error {
	videos := []models.Video{}
	if err := h.db.Select(&videos, `SELECT * FROM videos ORDER BY created_at DESC`); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(videos)
}

func (h *VideoHandler) Get(c *fiber.Ctx) error {
	id := c.Params("id")
	var v models.Video
	if err := h.db.Get(&v, `SELECT * FROM videos WHERE id = $1`, id); err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "видео не найдено"})
	}
	return c.JSON(v)
}

// PatchTags replaces the tag list for a video (PUT semantics on the tag array).
func (h *VideoHandler) PatchTags(c *fiber.Ctx) error {
	id := c.Params("id")
	var req struct {
		Tags []string `json:"tags"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "неверный запрос"})
	}

	// Sanitise: trim whitespace, deduplicate, drop empties.
	seen := map[string]bool{}
	tags := pq.StringArray{}
	for _, t := range req.Tags {
		t = strings.TrimSpace(t)
		if t != "" && !seen[t] {
			seen[t] = true
			tags = append(tags, t)
		}
	}
	if tags == nil {
		tags = pq.StringArray{}
	}

	var v models.Video
	if err := h.db.QueryRowx(
		`UPDATE videos SET tags=$1 WHERE id=$2 RETURNING *`, tags, id,
	).StructScan(&v); err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "видео не найдено"})
	}
	h.hub.Broadcast("video:updated", v)
	return c.JSON(v)
}

// UploadOne is the fast path: a single file streamed as the raw request body.
// No multipart parsing, no temp file. Used by the parallel uploader on the frontend.
//
// Headers/Query:
//   ?name=<urlencoded original filename>   (required)
//   Content-Length                         (sent by browser automatically)
func (h *VideoHandler) UploadOne(c *fiber.Ctx) error {
	origName := sanitizeOrigName(c.Query("name"))
	if origName == "" {
		return c.Status(400).JSON(fiber.Map{"error": "не указано имя файла"})
	}

	id := uuid.New().String()
	ext := strings.ToLower(filepath.Ext(origName))
	if ext == "" {
		ext = ".mp4"
	}
	filename := id + ext
	savePath := ffmpegworker.GetStreamPath(h.mediaPath, filename)

	f, err := os.Create(savePath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "ошибка создания файла: " + err.Error()})
	}

	bw := bufio.NewWriterSize(f, writeBufSize)
	size, copyErr := io.Copy(bw, c.Request().BodyStream())
	flushErr := bw.Flush()
	closeErr := f.Close()

	if copyErr != nil || flushErr != nil || closeErr != nil {
		_ = os.Remove(savePath)
		msg := "ошибка записи"
		if copyErr != nil {
			msg = "ошибка чтения тела: " + copyErr.Error()
		} else if flushErr != nil {
			msg = "ошибка сброса буфера: " + flushErr.Error()
		} else if closeErr != nil {
			msg = "ошибка закрытия файла: " + closeErr.Error()
		}
		return c.Status(500).JSON(fiber.Map{"error": msg})
	}

	if size == 0 {
		_ = os.Remove(savePath)
		return c.Status(400).JSON(fiber.Map{"error": "пустой файл"})
	}

	v := models.Video{
		ID:       id,
		Filename: filename,
		OrigName: origName,
		Path:     savePath,
		Size:     size,
	}
	if err := h.db.QueryRowx(`
		INSERT INTO videos (id, filename, orig_name, path, size)
		VALUES ($1,$2,$3,$4,$5) RETURNING *`,
		v.ID, v.Filename, v.OrigName, v.Path, v.Size,
	).StructScan(&v); err != nil {
		_ = os.Remove(savePath)
		return c.Status(500).JSON(fiber.Map{"error": "ошибка БД: " + err.Error()})
	}

	h.hub.Broadcast("video:uploaded", v)

	// Probe + thumbnail happen asynchronously on the worker pool.
	go h.probes.Submit(v)

	return c.Status(201).JSON(v)
}

// Upload is the legacy multipart batch endpoint. Kept for compatibility but
// the frontend now prefers UploadOne for parallelism and lower overhead.
func (h *VideoHandler) Upload(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "неверная форма"})
	}

	files := form.File["files"]
	if len(files) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "файлы не выбраны"})
	}

	uploaded := []models.Video{}
	for _, file := range files {
		id := uuid.New().String()
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if ext == "" {
			ext = ".mp4"
		}

		filename := id + ext
		savePath := ffmpegworker.GetStreamPath(h.mediaPath, filename)

		if err := c.SaveFile(file, savePath); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": fmt.Sprintf("ошибка сохранения %s: %v", file.Filename, err)})
		}

		v := models.Video{
			ID:       id,
			Filename: filename,
			OrigName: sanitizeOrigName(file.Filename),
			Path:     savePath,
			Size:     file.Size,
		}
		if err := h.db.QueryRowx(`
			INSERT INTO videos (id, filename, orig_name, path, size)
			VALUES ($1,$2,$3,$4,$5) RETURNING *`,
			v.ID, v.Filename, v.OrigName, v.Path, v.Size,
		).StructScan(&v); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "ошибка БД: " + err.Error()})
		}

		uploaded = append(uploaded, v)
		h.hub.Broadcast("video:uploaded", v)
		go h.probes.Submit(v)
	}

	return c.Status(201).JSON(uploaded)
}

func (h *VideoHandler) Delete(c *fiber.Ctx) error {
	id := c.Params("id")

	var v models.Video
	if err := h.db.Get(&v, `SELECT * FROM videos WHERE id = $1`, id); err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "видео не найдено"})
	}

	var inUse int
	_ = h.db.Get(&inUse, `SELECT COUNT(*) FROM streams WHERE current_video_id = $1 AND status IN ('live','starting')`, id)
	if inUse > 0 {
		return c.Status(409).JSON(fiber.Map{"error": "видео сейчас транслируется, остановите поток"})
	}

	if _, err := h.db.Exec(`DELETE FROM videos WHERE id = $1`, id); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	if v.Path != "" {
		if err := os.Remove(v.Path); err != nil && !os.IsNotExist(err) {
			log.Printf("delete video: remove %s: %v", v.Path, err)
		}
	}
	thumbPath := ffmpegworker.GetThumbnailPath(h.mediaPath, id)
	if err := os.Remove(thumbPath); err != nil && !os.IsNotExist(err) {
		log.Printf("delete video: remove thumb %s: %v", thumbPath, err)
	}

	h.hub.Broadcast("video:deleted", fiber.Map{"id": id})
	return c.JSON(fiber.Map{"ok": true})
}

func (h *VideoHandler) BulkDelete(c *fiber.Ctx) error {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := c.BodyParser(&req); err != nil || len(req.IDs) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "нет ids"})
	}

	deleted := []string{}
	skipped := []string{}

	for _, id := range req.IDs {
		var v models.Video
		if err := h.db.Get(&v, `SELECT * FROM videos WHERE id = $1`, id); err != nil {
			skipped = append(skipped, id)
			continue
		}
		var inUse int
		_ = h.db.Get(&inUse, `SELECT COUNT(*) FROM streams WHERE current_video_id = $1 AND status IN ('live','starting')`, id)
		if inUse > 0 {
			skipped = append(skipped, id)
			continue
		}
		if _, err := h.db.Exec(`DELETE FROM videos WHERE id = $1`, id); err != nil {
			skipped = append(skipped, id)
			continue
		}
		if v.Path != "" {
			_ = os.Remove(v.Path)
		}
		_ = os.Remove(ffmpegworker.GetThumbnailPath(h.mediaPath, id))
		deleted = append(deleted, id)
		h.hub.Broadcast("video:deleted", fiber.Map{"id": id})
	}

	return c.JSON(fiber.Map{
		"deleted": deleted,
		"skipped": skipped,
	})
}

func (h *VideoHandler) Reprobe(c *fiber.Ctx) error {
	id := c.Params("id")
	var v models.Video
	if err := h.db.Get(&v, `SELECT * FROM videos WHERE id = $1`, id); err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "видео не найдено"})
	}
	go h.probes.Submit(v)
	return c.JSON(fiber.Map{"ok": true})
}

// sanitizeOrigName strips path components and clamps length so a malicious
// or weird filename can't escape the uploads dir or blow up the DB column.
func sanitizeOrigName(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == "/" || name == `\` {
		return "upload"
	}
	// Strip control chars / NUL just in case.
	cleaned := make([]rune, 0, len(name))
	for _, r := range name {
		if r >= 0x20 && r != 0x7f {
			cleaned = append(cleaned, r)
		}
	}
	out := string(cleaned)
	if len(out) > 255 {
		out = out[:255]
	}
	if out == "" {
		return "upload"
	}
	return out
}
