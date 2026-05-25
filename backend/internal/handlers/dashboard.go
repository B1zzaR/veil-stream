package handlers

import (
	ffmpegworker "veil/internal/ffmpeg"
	"veil/internal/models"
	"veil/internal/ws"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"
)

type DashboardHandler struct {
	db  *sqlx.DB
	hub *ws.Hub
}

func NewDashboardHandler(db *sqlx.DB, hub *ws.Hub) *DashboardHandler {
	return &DashboardHandler{db: db, hub: hub}
}

func (h *DashboardHandler) Stats(c *fiber.Ctx) error {
	var totalStreams, liveStreams, totalVideos int
	var totalSize int64
	h.db.Get(&totalStreams, `SELECT COUNT(*) FROM streams`)
	h.db.Get(&liveStreams, `SELECT COUNT(*) FROM streams WHERE status = 'live'`)
	h.db.Get(&totalVideos, `SELECT COUNT(*) FROM videos`)
	h.db.Get(&totalSize, `SELECT COALESCE(SUM(size), 0) FROM videos`)

	cpu, ram := ffmpegworker.GetSysStats()

	// Disk space for the /media volume.
	diskTotal, diskFree := getDiskStats("/media")

	return c.JSON(fiber.Map{
		"total_streams":    totalStreams,
		"live_streams":     liveStreams,
		"total_videos":     totalVideos,
		"total_video_size": totalSize,
		"cpu":              cpu,
		"ram":              ram,
		"ws_clients":       h.hub.Count(),
		"disk_total":       diskTotal,
		"disk_free":        diskFree,
	})
}

// History returns the most recent stream events across all streams.
func (h *DashboardHandler) History(c *fiber.Ctx) error {
	limit := c.QueryInt("limit", 30)
	if limit < 1 {
		limit = 30
	}
	if limit > 200 {
		limit = 200
	}
	events := []models.StreamEvent{}
	if err := h.db.Select(&events,
		`SELECT * FROM stream_events ORDER BY id DESC LIMIT $1`, limit,
	); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(events)
}
