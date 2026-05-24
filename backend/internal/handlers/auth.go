package handlers

import (
	"time"

	"veil/internal/config"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v4"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	cfg          *config.Config
	passwordHash []byte
}

func NewAuthHandler(cfg *config.Config) *AuthHandler {
	hash, _ := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), bcrypt.DefaultCost)
	return &AuthHandler{cfg: cfg, passwordHash: hash}
}

func (h *AuthHandler) Login(c *fiber.Ctx) error {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "неверный запрос"})
	}

	if req.Username != h.cfg.AdminUsername {
		return c.Status(401).JSON(fiber.Map{"error": "неверные учётные данные"})
	}
	if err := bcrypt.CompareHashAndPassword(h.passwordHash, []byte(req.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "неверные учётные данные"})
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": req.Username,
		"exp": time.Now().Add(7 * 24 * time.Hour).Unix(),
	})
	signed, err := token.SignedString([]byte(h.cfg.JWTSecret))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "ошибка сервера"})
	}

	c.Cookie(&fiber.Cookie{
		Name:     "token",
		Value:    signed,
		HTTPOnly: true,
		SameSite: "Lax",
		MaxAge:   7 * 24 * 3600,
	})

	return c.JSON(fiber.Map{"token": signed, "username": req.Username})
}

func (h *AuthHandler) Logout(c *fiber.Ctx) error {
	c.Cookie(&fiber.Cookie{
		Name:    "token",
		Value:   "",
		MaxAge:  -1,
		Expires: time.Now().Add(-1 * time.Hour),
	})
	return c.JSON(fiber.Map{"ok": true})
}

func (h *AuthHandler) Me(c *fiber.Ctx) error {
	username := c.Locals("username")
	return c.JSON(fiber.Map{"username": username})
}
