package handlers

import (
	"veil/internal/telegram"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"
)

type AppSettingsHandler struct {
	db *sqlx.DB
}

func NewAppSettingsHandler(db *sqlx.DB) *AppSettingsHandler {
	return &AppSettingsHandler{db: db}
}

// Get returns all app settings as a key→value map.
func (h *AppSettingsHandler) Get(c *fiber.Ctx) error {
	rows, err := h.db.Query(`SELECT key, value FROM app_settings`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()
	result := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			result[k] = v
		}
	}
	return c.JSON(result)
}

// Update upserts one or more settings.
func (h *AppSettingsHandler) Update(c *fiber.Ctx) error {
	var req map[string]string
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "неверный запрос"})
	}
	for k, v := range req {
		if _, err := h.db.Exec(
			`INSERT INTO app_settings(key,value) VALUES($1,$2)
			 ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
			k, v,
		); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}
	return c.JSON(fiber.Map{"ok": true})
}

// TestTelegram sends a test message using the currently saved credentials.
func (h *AppSettingsHandler) TestTelegram(c *fiber.Ctx) error {
	token, chatID := h.telegramCreds()
	if token == "" || chatID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Telegram не настроен — укажите Bot Token и Chat ID"})
	}
	if err := telegram.Send(token, chatID, "✅ <b>Veil Stream</b> — тест уведомлений работает!"); err != nil {
		return c.Status(502).JSON(fiber.Map{"error": "Ошибка отправки: " + err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}

// telegramCreds fetches bot token and chat ID from the DB.
func (h *AppSettingsHandler) telegramCreds() (token, chatID string) {
	_ = h.db.Get(&token, `SELECT value FROM app_settings WHERE key='telegram_bot_token'`)
	_ = h.db.Get(&chatID, `SELECT value FROM app_settings WHERE key='telegram_chat_id'`)
	return
}

// TelegramCreds is exported so the worker can reuse it.
func TelegramCreds(db *sqlx.DB) (token, chatID string) {
	_ = db.Get(&token, `SELECT value FROM app_settings WHERE key='telegram_bot_token'`)
	_ = db.Get(&chatID, `SELECT value FROM app_settings WHERE key='telegram_chat_id'`)
	return
}
