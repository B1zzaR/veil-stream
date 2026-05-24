package handlers

import (
	"veil/internal/middleware"
	"veil/internal/ws"

	"github.com/gofiber/fiber/v2"
	gows "github.com/gofiber/websocket/v2"
)

type WSHandler struct {
	hub       *ws.Hub
	jwtSecret string
}

func NewWSHandler(hub *ws.Hub, jwtSecret string) *WSHandler {
	return &WSHandler{hub: hub, jwtSecret: jwtSecret}
}

// Upgrade validates the JWT (from cookie or ?token=) before upgrading the connection.
func (h *WSHandler) Upgrade(c *fiber.Ctx) error {
	if !gows.IsWebSocketUpgrade(c) {
		return fiber.ErrUpgradeRequired
	}

	token := c.Cookies("token")
	if token == "" {
		token = c.Query("token")
	}
	if _, ok := middleware.ValidateToken(token, h.jwtSecret); !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "не авторизован"})
	}
	return c.Next()
}

func (h *WSHandler) Handle() fiber.Handler {
	return gows.New(func(c *gows.Conn) {
		client := h.hub.Register(c)
		// WritePump runs in its own goroutine, ReadPump owns this one so the
		// gows callback doesn't return (it would close the connection on return).
		go client.WritePump()
		client.ReadPump()
	})
}
