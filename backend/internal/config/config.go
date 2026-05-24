package config

import (
	"log"
	"os"
	"strings"
)

type Config struct {
	Port          string
	DatabaseURL   string
	JWTSecret     string
	AdminUsername string
	AdminPassword string
	MediaPath     string
	Production    bool
}

func Load() *Config {
	cfg := &Config{
		Port:          getEnv("PORT", "8080"),
		DatabaseURL:   getEnv("DATABASE_URL", "postgres://veil:veil@localhost:5432/veil?sslmode=disable"),
		JWTSecret:     getEnv("JWT_SECRET", ""),
		AdminUsername: getEnv("ADMIN_USERNAME", ""),
		AdminPassword: getEnv("ADMIN_PASSWORD", ""),
		MediaPath:     getEnv("MEDIA_PATH", "/media"),
		Production:    strings.EqualFold(getEnv("ENV", "production"), "production"),
	}

	cfg.validate()
	return cfg
}

func (c *Config) validate() {
	var fatal []string

	if c.JWTSecret == "" {
		fatal = append(fatal, "JWT_SECRET is required (set in .env)")
	} else if len(c.JWTSecret) < 16 {
		fatal = append(fatal, "JWT_SECRET must be at least 16 characters")
	} else if isWeakSecret(c.JWTSecret) {
		log.Printf("config: WARNING — JWT_SECRET looks weak, consider a longer random string (32+ chars)")
	}

	if c.AdminUsername == "" {
		fatal = append(fatal, "ADMIN_USERNAME is required")
	}
	if c.AdminPassword == "" {
		fatal = append(fatal, "ADMIN_PASSWORD is required")
	} else if len(c.AdminPassword) < 6 {
		log.Printf("config: WARNING — ADMIN_PASSWORD shorter than 6 chars, use a stronger one")
	}

	if len(fatal) > 0 {
		for _, m := range fatal {
			log.Printf("config: %s", m)
		}
		log.Fatal("config: missing required environment variables — see .env.example")
	}

	log.Printf("config: loaded (production=%v, port=%s, media=%s)", c.Production, c.Port, c.MediaPath)
}

func isWeakSecret(s string) bool {
	if len(s) < 24 {
		return true
	}
	weak := []string{"change_me", "secret", "password", "admin", "test"}
	low := strings.ToLower(s)
	for _, w := range weak {
		if strings.Contains(low, w) {
			return true
		}
	}
	return false
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
