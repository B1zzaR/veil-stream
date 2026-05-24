package middleware

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v4"
)

// ValidateToken parses and validates a JWT, returning the "sub" claim on success.
func ValidateToken(token, secret string) (string, bool) {
	if token == "" {
		return "", false
	}
	parsed, err := jwt.Parse(token, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return []byte(secret), nil
	})
	if err != nil || !parsed.Valid {
		return "", false
	}
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return "", false
	}
	sub, _ := claims["sub"].(string)
	return sub, true
}

// extractToken pulls a token from cookie, Authorization header, or `?token=` query param.
func extractToken(c *fiber.Ctx) string {
	if t := c.Cookies("token"); t != "" {
		return t
	}
	if auth := c.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return auth[7:]
	}
	if t := c.Query("token"); t != "" {
		return t
	}
	return ""
}

func JWTAuth(secret string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		token := extractToken(c)
		sub, ok := ValidateToken(token, secret)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "не авторизован"})
		}
		c.Locals("username", sub)
		return c.Next()
	}
}

// JWTAuthWS is like JWTAuth but also accepts the token from a query param —
// browsers can't set headers when establishing a WebSocket connection.
func JWTAuthWS(secret string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		token := extractToken(c)
		sub, ok := ValidateToken(token, secret)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "не авторизован"})
		}
		c.Locals("username", sub)
		return c.Next()
	}
}
