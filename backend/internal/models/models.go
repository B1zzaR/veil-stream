package models

import "time"

type User struct {
	ID           int       `db:"id" json:"id"`
	Username     string    `db:"username" json:"username"`
	PasswordHash string    `db:"password_hash" json:"-"`
	CreatedAt    time.Time `db:"created_at" json:"created_at"`
}

type Video struct {
	ID            string    `db:"id" json:"id"`
	Filename      string    `db:"filename" json:"filename"`
	OrigName      string    `db:"orig_name" json:"orig_name"`
	Path          string    `db:"path" json:"path"`
	Size          int64     `db:"size" json:"size"`
	Duration      float64   `db:"duration" json:"duration"`
	Resolution    *string   `db:"resolution" json:"resolution"`
	Format        *string   `db:"format" json:"format"`
	VideoCodec    *string   `db:"video_codec" json:"video_codec"`
	AudioCodec    *string   `db:"audio_codec" json:"audio_codec"`
	StreamCopy    bool      `db:"stream_copy" json:"stream_copy"`
	ThumbnailPath *string   `db:"thumbnail_path" json:"thumbnail_path"`
	CreatedAt     time.Time `db:"created_at" json:"created_at"`
}

type Stream struct {
	ID              string     `db:"id" json:"id"`
	Name            string     `db:"name" json:"name"`
	RTMPUrl         string     `db:"rtmp_url" json:"rtmp_url"`
	StreamKey       string     `db:"stream_key" json:"stream_key"`
	Status          string     `db:"status" json:"status"`
	Resolution      string     `db:"resolution" json:"resolution"`
	FPS             int        `db:"fps" json:"fps"`
	Bitrate         int        `db:"bitrate" json:"bitrate"`
	AudioBitrate    int        `db:"audio_bitrate" json:"audio_bitrate"`
	Preset          string     `db:"preset" json:"preset"`
	OverlayEnabled     bool       `db:"overlay_enabled" json:"overlay_enabled"`
	OverlayLogoPath    *string    `db:"overlay_logo_path" json:"overlay_logo_path"`
	OverlayLogoPos     string     `db:"overlay_logo_pos" json:"overlay_logo_pos"`
	OverlayLogoSize    int        `db:"overlay_logo_size" json:"overlay_logo_size"`
	OverlayLogoOpacity float64    `db:"overlay_logo_opacity" json:"overlay_logo_opacity"`
	OverlayText        *string    `db:"overlay_text" json:"overlay_text"`
	OverlayTextPos     string     `db:"overlay_text_pos" json:"overlay_text_pos"`
	OverlayTextSize    int        `db:"overlay_text_size" json:"overlay_text_size"`
	AudioNormalize     bool       `db:"audio_normalize" json:"audio_normalize"`
	LoopMode        bool       `db:"loop_mode" json:"loop_mode"`
	ShuffleMode     bool       `db:"shuffle_mode" json:"shuffle_mode"`
	CurrentVideoID  *string    `db:"current_video_id" json:"current_video_id"`
	StartedAt       *time.Time `db:"started_at" json:"started_at"`
	CreatedAt       time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt       time.Time  `db:"updated_at" json:"updated_at"`
}

type QueueItem struct {
	ID        string    `db:"id" json:"id"`
	StreamID  string    `db:"stream_id" json:"stream_id"`
	VideoID   string    `db:"video_id" json:"video_id"`
	Position  int       `db:"position" json:"position"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	Video     *Video    `db:"-" json:"video,omitempty"`
}

// StreamEvent is a row in stream_events, a circular log of lifecycle events
// shown in the UI history panel.
type StreamEvent struct {
	ID        int64     `db:"id" json:"id"`
	StreamID  string    `db:"stream_id" json:"stream_id"`
	Type      string    `db:"type" json:"type"`
	Message   string    `db:"message" json:"message"`
	VideoID   *string   `db:"video_id" json:"video_id,omitempty"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

// Event type constants
const (
	EventStarted      = "started"
	EventStopped      = "stopped"
	EventCrashed      = "crashed"
	EventVideoChanged = "video_changed"
	EventError        = "error"
	EventSceneStarted = "scene_started"
)

// Status constants
const (
	StatusIdle     = "idle"
	StatusStarting = "starting"
	StatusLive     = "live"
	StatusStopping = "stopping"
	StatusError    = "error"
)

// WebSocket message types
type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type StreamStatusPayload struct {
	StreamID     string  `json:"stream_id"`
	Status       string  `json:"status"`
	CurrentVideo *Video  `json:"current_video"`
	Bitrate      float64 `json:"bitrate"`
	CPU          float64 `json:"cpu"`
	RAM          uint64  `json:"ram"`
	Uptime       int64   `json:"uptime"`
}
