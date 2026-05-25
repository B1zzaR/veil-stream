package handlers

import (
	"strings"

	"veil/internal/models"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"
)

type CollectionHandler struct {
	db *sqlx.DB
}

func NewCollectionHandler(db *sqlx.DB) *CollectionHandler {
	return &CollectionHandler{db: db}
}

// List returns all collections with their video counts.
func (h *CollectionHandler) List(c *fiber.Ctx) error {
	cols := []models.Collection{}
	err := h.db.Select(&cols, `
		SELECT c.id, c.name, c.created_at,
		       COUNT(cv.video_id) AS video_count
		FROM collections c
		LEFT JOIN collection_videos cv ON cv.collection_id = c.id
		GROUP BY c.id, c.name, c.created_at
		ORDER BY c.created_at ASC
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(cols)
}

// Create adds a new collection.
func (h *CollectionHandler) Create(c *fiber.Ctx) error {
	var req struct {
		Name string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "неверный запрос"})
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "название обязательно"})
	}
	var col models.Collection
	if err := h.db.QueryRowx(
		`INSERT INTO collections(name) VALUES($1) RETURNING id, name, created_at`,
		name,
	).StructScan(&col); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(201).JSON(col)
}

// Update renames a collection.
func (h *CollectionHandler) Update(c *fiber.Ctx) error {
	id := c.Params("id")
	var req struct {
		Name string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "неверный запрос"})
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "название обязательно"})
	}
	res, err := h.db.Exec(`UPDATE collections SET name=$1 WHERE id=$2`, name, id)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "папка не найдена"})
	}
	return c.JSON(fiber.Map{"ok": true, "id": id, "name": name})
}

// Delete removes a collection (videos stay in the library).
func (h *CollectionHandler) Delete(c *fiber.Ctx) error {
	id := c.Params("id")
	if _, err := h.db.Exec(`DELETE FROM collections WHERE id=$1`, id); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// Videos lists all videos in a collection, ordered by time added.
func (h *CollectionHandler) Videos(c *fiber.Ctx) error {
	id := c.Params("id")
	videos := []models.Video{}
	if err := h.db.Select(&videos, `
		SELECT v.* FROM videos v
		JOIN collection_videos cv ON cv.video_id = v.id
		WHERE cv.collection_id = $1
		ORDER BY cv.added_at ASC
	`, id); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(videos)
}

// AddVideos adds one or more videos to a collection (idempotent).
func (h *CollectionHandler) AddVideos(c *fiber.Ctx) error {
	id := c.Params("id")
	var req struct {
		VideoIDs []string `json:"video_ids"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "неверный запрос"})
	}
	if len(req.VideoIDs) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "нет видео"})
	}
	added := 0
	for _, vid := range req.VideoIDs {
		if _, err := h.db.Exec(`
			INSERT INTO collection_videos(collection_id, video_id)
			VALUES($1, $2) ON CONFLICT DO NOTHING
		`, id, vid); err == nil {
			added++
		}
	}
	return c.JSON(fiber.Map{"added": added})
}

// RemoveVideo removes one video from a collection without deleting the file.
func (h *CollectionHandler) RemoveVideo(c *fiber.Ctx) error {
	id := c.Params("id")
	videoID := c.Params("videoId")
	h.db.Exec(`DELETE FROM collection_videos WHERE collection_id=$1 AND video_id=$2`, id, videoID)
	return c.SendStatus(fiber.StatusNoContent)
}
