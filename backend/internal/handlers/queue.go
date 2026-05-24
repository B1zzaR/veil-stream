package handlers

import (
	"math/rand"

	"veil/internal/models"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type QueueHandler struct {
	db *sqlx.DB
}

func NewQueueHandler(db *sqlx.DB) *QueueHandler {
	return &QueueHandler{db: db}
}

// queueRow holds the JOIN result so we can fetch queue items + their video in one query.
type queueRow struct {
	models.QueueItem
	VideoID2       *string  `db:"v_id"`
	VFilename      *string  `db:"v_filename"`
	VOrigName      *string  `db:"v_orig_name"`
	VPath          *string  `db:"v_path"`
	VSize          *int64   `db:"v_size"`
	VDuration      *float64 `db:"v_duration"`
	VResolution    *string  `db:"v_resolution"`
	VFormat        *string  `db:"v_format"`
	VVideoCodec    *string  `db:"v_video_codec"`
	VAudioCodec    *string  `db:"v_audio_codec"`
	VStreamCopy    *bool    `db:"v_stream_copy"`
	VThumbnailPath *string  `db:"v_thumbnail_path"`
}

const queueSelect = `
SELECT q.id, q.stream_id, q.video_id, q.position, q.created_at,
       v.id AS v_id, v.filename AS v_filename, v.orig_name AS v_orig_name,
       v.path AS v_path, v.size AS v_size, v.duration AS v_duration,
       v.resolution AS v_resolution, v.format AS v_format,
       v.video_codec AS v_video_codec, v.audio_codec AS v_audio_codec,
       v.stream_copy AS v_stream_copy, v.thumbnail_path AS v_thumbnail_path
FROM queue_items q
LEFT JOIN videos v ON v.id = q.video_id
WHERE q.stream_id = $1
ORDER BY q.position ASC
`

func (h *QueueHandler) listItems(streamID string) ([]models.QueueItem, error) {
	rows := []queueRow{}
	if err := h.db.Select(&rows, queueSelect, streamID); err != nil {
		return nil, err
	}
	items := make([]models.QueueItem, 0, len(rows))
	for _, r := range rows {
		item := r.QueueItem
		if r.VideoID2 != nil {
			v := &models.Video{
				ID:            *r.VideoID2,
				Resolution:    r.VResolution,
				Format:        r.VFormat,
				VideoCodec:    r.VVideoCodec,
				AudioCodec:    r.VAudioCodec,
				ThumbnailPath: r.VThumbnailPath,
			}
			if r.VFilename != nil {
				v.Filename = *r.VFilename
			}
			if r.VOrigName != nil {
				v.OrigName = *r.VOrigName
			}
			if r.VPath != nil {
				v.Path = *r.VPath
			}
			if r.VSize != nil {
				v.Size = *r.VSize
			}
			if r.VDuration != nil {
				v.Duration = *r.VDuration
			}
			if r.VStreamCopy != nil {
				v.StreamCopy = *r.VStreamCopy
			}
			item.Video = v
		}
		items = append(items, item)
	}
	return items, nil
}

func (h *QueueHandler) List(c *fiber.Ctx) error {
	streamID := c.Params("id")
	items, err := h.listItems(streamID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(items)
}

func (h *QueueHandler) Add(c *fiber.Ctx) error {
	streamID := c.Params("id")
	var req struct {
		VideoIDs []string `json:"video_ids"`
	}
	if err := c.BodyParser(&req); err != nil || len(req.VideoIDs) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "нет video_ids"})
	}

	tx, err := h.db.Beginx()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer tx.Rollback()

	var maxPos int
	_ = tx.Get(&maxPos, `SELECT COALESCE(MAX(position), 0) FROM queue_items WHERE stream_id = $1`, streamID)

	for _, videoID := range req.VideoIDs {
		maxPos++
		if _, err := tx.Exec(`
			INSERT INTO queue_items (id, stream_id, video_id, position)
			VALUES ($1, $2, $3, $4)`,
			uuid.New().String(), streamID, videoID, maxPos,
		); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "ошибка добавления: " + err.Error()})
		}
	}
	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return h.List(c)
}

func (h *QueueHandler) Remove(c *fiber.Ctx) error {
	streamID := c.Params("id")
	itemID := c.Params("itemId")
	if _, err := h.db.Exec(`DELETE FROM queue_items WHERE id = $1 AND stream_id = $2`, itemID, streamID); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	h.renumber(streamID)
	return c.JSON(fiber.Map{"ok": true})
}

func (h *QueueHandler) Clear(c *fiber.Ctx) error {
	streamID := c.Params("id")
	if _, err := h.db.Exec(`DELETE FROM queue_items WHERE stream_id = $1`, streamID); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}

func (h *QueueHandler) Reorder(c *fiber.Ctx) error {
	streamID := c.Params("id")
	var req struct {
		Items []struct {
			ID       string `json:"id"`
			Position int    `json:"position"`
		} `json:"items"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "неверный запрос"})
	}

	tx, err := h.db.Beginx()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer tx.Rollback()

	// Two-phase: push to negative space first, then assign final positions.
	// Avoids collisions if a (stream_id, position) uniqueness constraint is added later.
	for _, item := range req.Items {
		if _, err := tx.Exec(
			`UPDATE queue_items SET position = -ABS(position) - 1000000 WHERE id=$1 AND stream_id=$2`,
			item.ID, streamID,
		); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}
	for _, item := range req.Items {
		if _, err := tx.Exec(
			`UPDATE queue_items SET position=$1 WHERE id=$2 AND stream_id=$3`,
			item.Position, item.ID, streamID,
		); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}
	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return h.List(c)
}

func (h *QueueHandler) Shuffle(c *fiber.Ctx) error {
	streamID := c.Params("id")
	var ids []string
	if err := h.db.Select(&ids, `SELECT id FROM queue_items WHERE stream_id = $1`, streamID); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	rand.Shuffle(len(ids), func(i, j int) { ids[i], ids[j] = ids[j], ids[i] })

	tx, err := h.db.Beginx()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer tx.Rollback()
	for pos, id := range ids {
		if _, err := tx.Exec(`UPDATE queue_items SET position=$1 WHERE id=$2`, pos+1, id); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}
	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return h.List(c)
}

func (h *QueueHandler) Settings(c *fiber.Ctx) error {
	streamID := c.Params("id")
	var s struct {
		LoopMode    bool `db:"loop_mode" json:"loop_mode"`
		ShuffleMode bool `db:"shuffle_mode" json:"shuffle_mode"`
	}
	if err := h.db.Get(&s, `SELECT loop_mode, shuffle_mode FROM streams WHERE id = $1`, streamID); err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "поток не найден"})
	}
	return c.JSON(s)
}

func (h *QueueHandler) UpdateSettings(c *fiber.Ctx) error {
	streamID := c.Params("id")
	var req struct {
		LoopMode    *bool `json:"loop_mode"`
		ShuffleMode *bool `json:"shuffle_mode"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "неверный запрос"})
	}
	if req.LoopMode != nil {
		if _, err := h.db.Exec(`UPDATE streams SET loop_mode=$1 WHERE id=$2`, *req.LoopMode, streamID); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}
	if req.ShuffleMode != nil {
		if _, err := h.db.Exec(`UPDATE streams SET shuffle_mode=$1 WHERE id=$2`, *req.ShuffleMode, streamID); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}
	return h.Settings(c)
}

func (h *QueueHandler) renumber(streamID string) {
	h.db.Exec(`
		UPDATE queue_items SET position = sub.rn
		FROM (
			SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS rn
			FROM queue_items WHERE stream_id = $1
		) sub
		WHERE queue_items.id = sub.id
	`, streamID)
}
