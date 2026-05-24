package handlers

import (
	"context"
	"path/filepath"
	"strings"
	"time"

	ffmpegworker "veil/internal/ffmpeg"
	"veil/internal/models"
	"veil/internal/ws"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"
)

const (
	maxLogoSize = 5 * 1024 * 1024 // 5MB
)

var allowedLogoExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".webp": true,
}

type StreamHandler struct {
	db        *sqlx.DB
	worker    *ffmpegworker.Worker
	hub       *ws.Hub
	mediaPath string
}

func NewStreamHandler(db *sqlx.DB, worker *ffmpegworker.Worker, hub *ws.Hub, mediaPath string) *StreamHandler {
	return &StreamHandler{db: db, worker: worker, hub: hub, mediaPath: mediaPath}
}

func (h *StreamHandler) List(c *fiber.Ctx) error {
	streams := []models.Stream{}
	if err := h.db.Select(&streams, `SELECT * FROM streams ORDER BY created_at DESC`); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(streams)
}

func (h *StreamHandler) Create(c *fiber.Ctx) error {
	var req struct {
		Name         string `json:"name"`
		RTMPUrl      string `json:"rtmp_url"`
		StreamKey    string `json:"stream_key"`
		Resolution   string `json:"resolution"`
		FPS          int    `json:"fps"`
		Bitrate      int    `json:"bitrate"`
		AudioBitrate int    `json:"audio_bitrate"`
		Preset       string `json:"preset"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "неверный запрос"})
	}
	req.Name = strings.TrimSpace(req.Name)
	req.StreamKey = strings.TrimSpace(req.StreamKey)
	if req.Name == "" || req.StreamKey == "" {
		return c.Status(400).JSON(fiber.Map{"error": "название и ключ потока обязательны"})
	}
	if req.RTMPUrl == "" {
		req.RTMPUrl = "rtmp://a.rtmp.youtube.com/live2"
	}
	if req.Resolution == "" {
		req.Resolution = "1280x720"
	}
	if req.FPS == 0 {
		req.FPS = 30
	}
	if req.Bitrate == 0 {
		req.Bitrate = 3000
	}
	if req.AudioBitrate == 0 {
		req.AudioBitrate = 128
	}
	if req.Preset == "" {
		req.Preset = "veryfast"
	}

	var s models.Stream
	err := h.db.QueryRowx(`
		INSERT INTO streams (name, rtmp_url, stream_key, resolution, fps, bitrate, audio_bitrate, preset)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING *`,
		req.Name, req.RTMPUrl, req.StreamKey,
		req.Resolution, req.FPS, req.Bitrate, req.AudioBitrate, req.Preset,
	).StructScan(&s)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	h.hub.Broadcast("stream:created", s)
	return c.Status(201).JSON(s)
}

func (h *StreamHandler) Get(c *fiber.Ctx) error {
	id := c.Params("id")
	var s models.Stream
	if err := h.db.Get(&s, `SELECT * FROM streams WHERE id = $1`, id); err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "поток не найден"})
	}
	return c.JSON(s)
}

func (h *StreamHandler) Update(c *fiber.Ctx) error {
	id := c.Params("id")
	var req struct {
		Name               *string  `json:"name"`
		RTMPUrl            *string  `json:"rtmp_url"`
		StreamKey          *string  `json:"stream_key"`
		Resolution         *string  `json:"resolution"`
		FPS                *int     `json:"fps"`
		Bitrate            *int     `json:"bitrate"`
		AudioBitrate       *int     `json:"audio_bitrate"`
		Preset             *string  `json:"preset"`
		LoopMode           *bool    `json:"loop_mode"`
		ShuffleMode        *bool    `json:"shuffle_mode"`
		OverlayEnabled     *bool    `json:"overlay_enabled"`
		OverlayText        *string  `json:"overlay_text"`
		OverlayTextPos     *string  `json:"overlay_text_pos"`
		OverlayLogoPos     *string  `json:"overlay_logo_pos"`
		OverlayLogoSize    *int     `json:"overlay_logo_size"`
		OverlayLogoOpacity *float64 `json:"overlay_logo_opacity"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "неверный запрос"})
	}

	var s models.Stream
	if err := h.db.Get(&s, `SELECT * FROM streams WHERE id = $1`, id); err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "поток не найден"})
	}

	if req.Name != nil {
		s.Name = strings.TrimSpace(*req.Name)
	}
	if req.RTMPUrl != nil {
		s.RTMPUrl = *req.RTMPUrl
	}
	if req.StreamKey != nil {
		s.StreamKey = strings.TrimSpace(*req.StreamKey)
	}
	if req.Resolution != nil {
		s.Resolution = *req.Resolution
	}
	if req.FPS != nil {
		s.FPS = *req.FPS
	}
	if req.Bitrate != nil {
		s.Bitrate = *req.Bitrate
	}
	if req.AudioBitrate != nil {
		s.AudioBitrate = *req.AudioBitrate
	}
	if req.Preset != nil {
		s.Preset = *req.Preset
	}
	if req.LoopMode != nil {
		s.LoopMode = *req.LoopMode
	}
	if req.ShuffleMode != nil {
		s.ShuffleMode = *req.ShuffleMode
	}
	if req.OverlayEnabled != nil {
		s.OverlayEnabled = *req.OverlayEnabled
	}
	if req.OverlayText != nil {
		s.OverlayText = req.OverlayText
	}
	if req.OverlayTextPos != nil {
		s.OverlayTextPos = *req.OverlayTextPos
	}
	if req.OverlayLogoPos != nil {
		s.OverlayLogoPos = *req.OverlayLogoPos
	}
	if req.OverlayLogoSize != nil {
		size := *req.OverlayLogoSize
		if size < 10 {
			size = 10
		} else if size > 500 {
			size = 500
		}
		s.OverlayLogoSize = size
	}
	if req.OverlayLogoOpacity != nil {
		op := *req.OverlayLogoOpacity
		if op < 0 {
			op = 0
		} else if op > 1 {
			op = 1
		}
		s.OverlayLogoOpacity = op
	}

	_, err := h.db.Exec(`
		UPDATE streams SET
			name=$1, rtmp_url=$2, stream_key=$3,
			resolution=$4, fps=$5, bitrate=$6, audio_bitrate=$7, preset=$8,
			loop_mode=$9, shuffle_mode=$10,
			overlay_enabled=$11, overlay_text=$12, overlay_text_pos=$13, overlay_logo_pos=$14,
			overlay_logo_size=$15, overlay_logo_opacity=$16,
			updated_at=$17
		WHERE id=$18`,
		s.Name, s.RTMPUrl, s.StreamKey,
		s.Resolution, s.FPS, s.Bitrate, s.AudioBitrate, s.Preset,
		s.LoopMode, s.ShuffleMode,
		s.OverlayEnabled, s.OverlayText, s.OverlayTextPos, s.OverlayLogoPos,
		s.OverlayLogoSize, s.OverlayLogoOpacity,
		time.Now(), id,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	h.hub.Broadcast("stream:updated", s)
	return c.JSON(s)
}

func (h *StreamHandler) Delete(c *fiber.Ctx) error {
	id := c.Params("id")
	h.worker.StopStream(id)
	if _, err := h.db.Exec(`DELETE FROM streams WHERE id = $1`, id); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	h.hub.Broadcast("stream:deleted", fiber.Map{"id": id})
	return c.JSON(fiber.Map{"ok": true})
}

func (h *StreamHandler) Start(c *fiber.Ctx) error {
	id := c.Params("id")
	if err := h.worker.StartStream(context.Background(), id); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (h *StreamHandler) Stop(c *fiber.Ctx) error {
	id := c.Params("id")
	h.worker.StopStream(id)
	return c.JSON(fiber.Map{"ok": true})
}

func (h *StreamHandler) Restart(c *fiber.Ctx) error {
	id := c.Params("id")
	if err := h.worker.RestartStream(context.Background(), id); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (h *StreamHandler) ActivateScene(c *fiber.Ctx) error {
	id := c.Params("id")
	var req struct {
		Scene string `json:"scene"`
		Text  string `json:"text"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "неверный запрос"})
	}

	var s models.Stream
	if err := h.db.Get(&s, `SELECT * FROM streams WHERE id = $1`, id); err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "поток не найден"})
	}

	text := req.Text
	if text == "" {
		switch req.Scene {
		case "starting":
			text = "Скоро начнём..."
		case "pause":
			text = "Пауза"
		case "offline":
			text = "Офлайн"
		}
	}

	h.worker.StopStream(id)
	time.Sleep(1 * time.Second)

	bgColor := "black"
	if req.Scene == "starting" {
		bgColor = "0x1a1a2e"
	}

	go func() {
		args := ffmpegworker.BuildSceneArgs(text, bgColor, s.Resolution, s.RTMPUrl, s.StreamKey, s.FPS)
		_ = h.worker.RunSceneFFmpeg(context.Background(), id, args)
	}()

	return c.JSON(fiber.Map{"ok": true})
}

func (h *StreamHandler) UploadLogo(c *fiber.Ctx) error {
	id := c.Params("id")
	file, err := c.FormFile("logo")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "файл не найден"})
	}

	if file.Size > maxLogoSize {
		return c.Status(413).JSON(fiber.Map{"error": "файл слишком большой (макс. 5 МБ)"})
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if !allowedLogoExts[ext] {
		return c.Status(400).JSON(fiber.Map{"error": "поддерживаются только PNG/JPG/WEBP"})
	}

	var s models.Stream
	if err := h.db.Get(&s, `SELECT * FROM streams WHERE id = $1`, id); err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "поток не найден"})
	}

	savePath := filepath.Join(h.mediaPath, "logos", id+"_logo"+ext)
	if err := c.SaveFile(file, savePath); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "ошибка сохранения файла"})
	}

	if _, err := h.db.Exec(`UPDATE streams SET overlay_logo_path=$1, updated_at=NOW() WHERE id=$2`,
		savePath, id); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{"path": savePath})
}

// Events returns the most recent stream_events for a stream.
func (h *StreamHandler) Events(c *fiber.Ctx) error {
	id := c.Params("id")
	limit := c.QueryInt("limit", 50)
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	events := []models.StreamEvent{}
	if err := h.db.Select(&events,
		`SELECT * FROM stream_events WHERE stream_id = $1 ORDER BY id DESC LIMIT $2`,
		id, limit,
	); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(events)
}

// Status returns the live runtime status of a stream (whether the worker has a process).
func (h *StreamHandler) Status(c *fiber.Ctx) error {
	id := c.Params("id")
	return c.JSON(fiber.Map{
		"id":      id,
		"running": h.worker.IsRunning(id),
	})
}
