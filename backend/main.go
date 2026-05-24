package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"veil/internal/config"
	"veil/internal/database"
	ffmpegworker "veil/internal/ffmpeg"
	"veil/internal/handlers"
	"veil/internal/middleware"
	"veil/internal/ws"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/jmoiron/sqlx"
)

func main() {
	cfg := config.Load()

	db := database.Connect(cfg.DatabaseURL)
	defer db.Close()

	mediaPath := cfg.MediaPath
	for _, dir := range []string{"uploads", "thumbnails", "logos", "scenes"} {
		if err := os.MkdirAll(filepath.Join(mediaPath, dir), 0755); err != nil {
			log.Fatalf("mkdir %s: %v", dir, err)
		}
	}

	// Root context that gets cancelled on SIGTERM/SIGINT — propagates to workers.
	rootCtx, rootCancel := context.WithCancel(context.Background())
	defer rootCancel()

	hub := ws.NewHub()
	worker := ffmpegworker.NewWorker(db, hub, mediaPath)
	worker.Start(rootCtx)

	// Periodic background tasks.
	go runPeriodic(rootCtx, db)

	// Probe/thumbnail pool — bounded so bulk uploads can't fork dozens of ffmpegs.
	probes := handlers.NewProbeQueue(db, hub, mediaPath, 2, 64)

	authH := handlers.NewAuthHandler(cfg)
	streamH := handlers.NewStreamHandler(db, worker, hub, mediaPath)
	videoH := handlers.NewVideoHandler(db, hub, mediaPath, probes)
	queueH := handlers.NewQueueHandler(db)
	dashH := handlers.NewDashboardHandler(db, hub)
	wsH := handlers.NewWSHandler(hub, cfg.JWTSecret)
	settingsH := handlers.NewAppSettingsHandler(db)

	const gb = 1024 * 1024 * 1024
	app := fiber.New(fiber.Config{
		BodyLimit:             10 * gb,
		ReadTimeout:           2 * time.Hour,
		WriteTimeout:          2 * time.Hour,
		DisableStartupMessage: true,
		// Stream request bodies straight to handlers instead of buffering whole body
		// to memory/disk before dispatch — critical for multi-GB uploads.
		StreamRequestBody:       true,
		DisablePreParseMultipartForm: true,
	})

	app.Use(recover.New())
	app.Use(logger.New(logger.Config{
		Format: "[${time}] ${status} ${method} ${path} ${latency}\n",
	}))
	app.Use(cors.New(cors.Config{
		AllowOrigins:     "*",
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
		AllowMethods:     "GET,POST,PUT,DELETE,OPTIONS",
		AllowCredentials: false,
	}))

	app.Get("/healthz", func(c *fiber.Ctx) error {
		if err := db.Ping(); err != nil {
			return c.Status(503).JSON(fiber.Map{"ok": false, "db": false})
		}
		return c.JSON(fiber.Map{"ok": true, "ws_clients": hub.Count()})
	})

	// Public auth routes (rate-limited)
	authRoutes := app.Group("/api/auth")
	authRoutes.Use(limiter.New(limiter.Config{
		Max:        20,
		Expiration: 1 * time.Minute,
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "Слишком много попыток входа. Подождите 1 минуту.",
			})
		},
	}))
	authRoutes.Post("/login", authH.Login)
	authRoutes.Post("/logout", authH.Logout)

	// Protected routes
	api := app.Group("/api", middleware.JWTAuth(cfg.JWTSecret))
	api.Get("/auth/me", authH.Me)
	api.Get("/dashboard/stats", dashH.Stats)
	api.Get("/dashboard/history", dashH.History)

	// Streams
	streams := api.Group("/streams")
	streams.Get("/", streamH.List)
	streams.Post("/", streamH.Create)
	streams.Get("/:id", streamH.Get)
	streams.Put("/:id", streamH.Update)
	streams.Delete("/:id", streamH.Delete)
	streams.Post("/:id/start", streamH.Start)
	streams.Post("/:id/stop", streamH.Stop)
	streams.Post("/:id/restart", streamH.Restart)
	streams.Post("/:id/skip", streamH.Skip)
	streams.Post("/:id/scene", streamH.ActivateScene)
	streams.Post("/:id/logo", streamH.UploadLogo)
	streams.Get("/:id/events", streamH.Events)
	streams.Get("/:id/status", streamH.Status)

	// Queue
	streams.Get("/:id/queue", queueH.List)
	streams.Post("/:id/queue", queueH.Add)
	streams.Delete("/:id/queue/all", queueH.Clear)
	streams.Delete("/:id/queue/:itemId", queueH.Remove)
	streams.Put("/:id/queue/reorder", queueH.Reorder)
	streams.Post("/:id/queue/shuffle", queueH.Shuffle)
	streams.Get("/:id/queue/settings", queueH.Settings)
	streams.Put("/:id/queue/settings", queueH.UpdateSettings)

	// Videos
	videos := api.Group("/videos")
	videos.Get("/", videoH.List)
	videos.Get("/:id", videoH.Get)
	videos.Post("/upload", videoH.Upload)         // legacy multipart batch
	videos.Post("/upload-one", videoH.UploadOne)  // fast single-file streaming path
	videos.Post("/download", videoH.Download)     // yt-dlp download by URL
	videos.Delete("/bulk", videoH.BulkDelete)
	videos.Delete("/:id", videoH.Delete)
	videos.Post("/:id/reprobe", videoH.Reprobe)

	// App settings (Telegram, etc.)
	api.Get("/settings", settingsH.Get)
	api.Put("/settings", settingsH.Update)
	api.Post("/settings/telegram/test", settingsH.TestTelegram)

	// WebSocket — JWT validated on upgrade (cookie or ?token=)
	app.Get("/ws", wsH.Upgrade, wsH.Handle())

	// Graceful shutdown
	shutdownCh := make(chan os.Signal, 1)
	signal.Notify(shutdownCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("veil: starting on :%s", cfg.Port)
		if err := app.Listen(":" + cfg.Port); err != nil {
			log.Fatalf("listen: %v", err)
		}
	}()

	<-shutdownCh
	log.Println("veil: shutdown signal received")

	// Stop accepting new requests.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := app.ShutdownWithContext(shutdownCtx); err != nil {
		log.Printf("veil: app shutdown: %v", err)
	}

	// Stop FFmpeg processes.
	worker.Shutdown()
	rootCancel()

	log.Println("veil: bye")
}

func runPeriodic(ctx context.Context, db *sqlx.DB) {
	// Prune old events daily.
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	// Initial prune shortly after startup.
	go func() {
		time.Sleep(30 * time.Second)
		database.PruneEvents(db)
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			database.PruneEvents(db)
		}
	}
}
