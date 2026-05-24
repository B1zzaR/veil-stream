package database

import (
	"log"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
)

func Connect(dsn string) *sqlx.DB {
	var db *sqlx.DB
	var err error

	for i := 0; i < 10; i++ {
		db, err = sqlx.Connect("postgres", dsn)
		if err == nil {
			break
		}
		log.Printf("db: waiting for postgres (%d/10): %v", i+1, err)
		time.Sleep(3 * time.Second)
	}
	if err != nil {
		log.Fatalf("db: failed to connect: %v", err)
	}

	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	Migrate(db)
	return db
}

func Migrate(db *sqlx.DB) {
	schema := `
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename VARCHAR(255) NOT NULL,
    orig_name VARCHAR(255) NOT NULL,
    path VARCHAR(500) NOT NULL,
    size BIGINT NOT NULL DEFAULT 0,
    duration FLOAT NOT NULL DEFAULT 0,
    resolution VARCHAR(20),
    format VARCHAR(20),
    video_codec VARCHAR(20),
    audio_codec VARCHAR(20),
    stream_copy BOOLEAN DEFAULT FALSE,
    thumbnail_path VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS streams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    rtmp_url VARCHAR(500) NOT NULL DEFAULT 'rtmp://a.rtmp.youtube.com/live2',
    stream_key VARCHAR(500) NOT NULL,
    status VARCHAR(20) DEFAULT 'idle',
    resolution VARCHAR(20) DEFAULT '1280x720',
    fps INTEGER DEFAULT 30,
    bitrate INTEGER DEFAULT 3000,
    audio_bitrate INTEGER DEFAULT 128,
    preset VARCHAR(20) DEFAULT 'veryfast',
    overlay_enabled BOOLEAN DEFAULT FALSE,
    overlay_logo_path VARCHAR(500),
    overlay_logo_pos VARCHAR(20) DEFAULT 'top-right',
    overlay_logo_size INTEGER NOT NULL DEFAULT 15,
    overlay_logo_opacity FLOAT NOT NULL DEFAULT 1.0,
    overlay_text VARCHAR(255),
    overlay_text_pos VARCHAR(20) DEFAULT 'bottom-left',
    overlay_text_size INTEGER NOT NULL DEFAULT 28,
    audio_normalize BOOLEAN NOT NULL DEFAULT false,
    loop_mode BOOLEAN DEFAULT TRUE,
    shuffle_mode BOOLEAN DEFAULT FALSE,
    current_video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queue_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stream_events (
    id BIGSERIAL PRIMARY KEY,
    stream_id UUID NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
    type VARCHAR(32) NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_queue_items_stream_pos ON queue_items(stream_id, position);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_streams_status ON streams(status);
CREATE INDEX IF NOT EXISTS idx_stream_events_recent ON stream_events(stream_id, created_at DESC);
`
	if _, err := db.Exec(schema); err != nil {
		log.Fatalf("db: migration failed: %v", err)
	}

	// Add new columns to existing databases (idempotent — IF NOT EXISTS).
	migrations := []string{
		`ALTER TABLE streams ADD COLUMN IF NOT EXISTS overlay_logo_size INTEGER NOT NULL DEFAULT 15`,
		`ALTER TABLE streams ADD COLUMN IF NOT EXISTS overlay_logo_opacity FLOAT NOT NULL DEFAULT 1.0`,
		`ALTER TABLE streams ADD COLUMN IF NOT EXISTS overlay_text_size INTEGER NOT NULL DEFAULT 28`,
		`ALTER TABLE streams ADD COLUMN IF NOT EXISTS audio_normalize BOOLEAN NOT NULL DEFAULT false`,
		// overlay_logo_size used to mean "% of logo's own size" (broken — size 100 = no change).
		// Now it means "% of video frame width". Reset any old default/large values.
		`UPDATE streams SET overlay_logo_size = 15 WHERE overlay_logo_size >= 50 OR overlay_logo_size < 5`,
	}
	for _, q := range migrations {
		if _, err := db.Exec(q); err != nil {
			log.Printf("db: migration warning (non-fatal): %v", err)
		}
	}

	// Backfill defaults for legacy rows so *string fields cleanly load (idempotent).
	cleanup := []string{
		`UPDATE streams SET overlay_logo_pos = 'top-right' WHERE overlay_logo_pos IS NULL`,
		`UPDATE streams SET overlay_text_pos = 'bottom-left' WHERE overlay_text_pos IS NULL`,
		`UPDATE streams SET status = 'idle' WHERE status IS NULL`,
	}
	for _, q := range cleanup {
		if _, err := db.Exec(q); err != nil {
			log.Printf("db: cleanup warning (non-fatal): %v", err)
		}
	}

	// Reset any "live"/"starting" status that survived a crash — the worker will
	// pick them back up explicitly via Worker.Start.
	log.Println("db: migrations applied")
}

// PruneEvents keeps stream_events bounded: trims older-than-30d entries.
// Cheap enough to call periodically; the index keeps this fast.
func PruneEvents(db *sqlx.DB) {
	_, err := db.Exec(`DELETE FROM stream_events WHERE created_at < NOW() - INTERVAL '30 days'`)
	if err != nil {
		log.Printf("db: prune events: %v", err)
	}
}
