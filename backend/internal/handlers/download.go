package handlers

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"veil/internal/models"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// Download starts a yt-dlp download in the background and streams progress
// events over WebSocket (type "video:download_progress").
//
// POST /api/videos/download  { "url": "https://..." }
// Returns immediately with {"id": "<jobID>"}.
func (h *VideoHandler) Download(c *fiber.Ctx) error {
	var req struct {
		URL string `json:"url"`
	}
	if err := c.BodyParser(&req); err != nil || strings.TrimSpace(req.URL) == "" {
		return c.Status(400).JSON(fiber.Map{"error": "URL обязателен"})
	}

	jobID := uuid.New().String()
	go h.runDownload(jobID, strings.TrimSpace(req.URL))
	return c.JSON(fiber.Map{"id": jobID, "ok": true})
}

func (h *VideoHandler) runDownload(jobID, rawURL string) {
	broadcastDL := func(pct float64, status, name, errMsg string) {
		h.hub.Broadcast("video:download_progress", map[string]interface{}{
			"id":     jobID,
			"pct":    pct,
			"status": status,
			"name":   name,
			"error":  errMsg,
		})
	}

	// ── Step 1: resolve title (best-effort) ──────────────────────────────
	name := rawURL
	if out, err := exec.Command("yt-dlp", "--get-title", "--no-playlist", rawURL).Output(); err == nil {
		if t := strings.TrimSpace(string(out)); t != "" {
			name = t
		}
	}
	broadcastDL(0, "downloading", name, "")

	// ── Step 2: download ─────────────────────────────────────────────────
	outDir := filepath.Join(h.mediaPath, "uploads")
	outTpl := filepath.Join(outDir, jobID+".%(ext)s")

	cmd := exec.Command("yt-dlp",
		"--no-playlist",
		"--newline",
		"-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
		"--merge-output-format", "mp4",
		"--no-warnings",
		"-o", outTpl,
		rawURL,
	)

	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		log.Printf("yt-dlp: start failed: %v", err)
		broadcastDL(0, "error", name, "yt-dlp не найден — проверьте установку")
		return
	}

	// Parse progress lines in parallel.
	go func() {
		scanner := bufio.NewScanner(pr)
		for scanner.Scan() {
			line := scanner.Text()
			if pct := parseYtDlpPct(line); pct >= 0 {
				broadcastDL(pct, "downloading", name, "")
			}
		}
	}()

	err := cmd.Wait()
	_ = pw.Close()

	if err != nil {
		log.Printf("yt-dlp: download failed for %s: %v", rawURL, err)
		broadcastDL(0, "error", name, "Ошибка загрузки: "+err.Error())
		return
	}

	// ── Step 3: find result file ─────────────────────────────────────────
	matches, _ := filepath.Glob(filepath.Join(outDir, jobID+".*"))
	if len(matches) == 0 {
		broadcastDL(0, "error", name, "Файл не найден после загрузки")
		return
	}
	savePath := matches[0]

	// ── Step 4: probe + insert into DB ───────────────────────────────────
	fi, err := os.Stat(savePath)
	if err != nil {
		broadcastDL(0, "error", name, "Ошибка чтения файла")
		return
	}

	id := uuid.New().String()
	ext := filepath.Ext(savePath)
	newFilename := id + ext
	newPath := filepath.Join(outDir, newFilename)
	if err := os.Rename(savePath, newPath); err != nil {
		newPath = savePath
		newFilename = filepath.Base(savePath)
	}

	origName := sanitizeOrigName(name + ext)

	v := models.Video{
		ID:       id,
		Filename: newFilename,
		OrigName: origName,
		Path:     newPath,
		Size:     fi.Size(),
	}
	if err := h.db.QueryRowx(`
		INSERT INTO videos (id, filename, orig_name, path, size)
		VALUES ($1,$2,$3,$4,$5) RETURNING *`,
		v.ID, v.Filename, v.OrigName, v.Path, v.Size,
	).StructScan(&v); err != nil {
		log.Printf("yt-dlp: db insert: %v", err)
		broadcastDL(0, "error", name, "Ошибка записи в базу данных")
		return
	}

	h.hub.Broadcast("video:uploaded", v)
	broadcastDL(100, "done", name, "")

	// Probe + thumbnail async.
	go h.probes.Submit(v)

	log.Printf("yt-dlp: downloaded %q → %s", name, newPath)
}

// parseYtDlpPct extracts the download percentage from a yt-dlp progress line.
// Returns -1 if the line doesn't contain a percentage.
func parseYtDlpPct(line string) float64 {
	if !strings.Contains(line, "[download]") {
		return -1
	}
	for _, field := range strings.Fields(line) {
		field = strings.TrimSuffix(field, "%")
		if v, err := strconv.ParseFloat(field, 64); err == nil && v >= 0 && v <= 100 {
			return v
		}
	}
	return -1
}

// CancelDownload kills a running yt-dlp job (future extension point).
// Currently unused but wired for the route below.
func (h *VideoHandler) CancelDownload(c *fiber.Ctx) error {
	return fmt.Errorf("not implemented")
}
