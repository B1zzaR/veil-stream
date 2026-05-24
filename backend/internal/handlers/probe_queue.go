package handlers

import (
	"log"

	ffmpegworker "veil/internal/ffmpeg"
	"veil/internal/models"
	"veil/internal/ws"

	"github.com/jmoiron/sqlx"
)

// probeJob is the unit of work for the probe pool: probe + thumbnail + DB update.
type probeJob struct {
	VideoID string
	Path    string
}

// ProbeQueue runs ffprobe + thumbnail generation on a bounded worker pool.
// On a 2-vCPU VPS this caps the parallelism so 30 simultaneous uploads
// don't fork 30 ffmpegs and thrash the CPU.
type ProbeQueue struct {
	db        *sqlx.DB
	hub       *ws.Hub
	mediaPath string
	jobs      chan probeJob
}

// NewProbeQueue starts `workers` background goroutines that consume jobs.
// `queueDepth` is the buffered channel size — uploads block briefly if exceeded.
func NewProbeQueue(db *sqlx.DB, hub *ws.Hub, mediaPath string, workers, queueDepth int) *ProbeQueue {
	if workers < 1 {
		workers = 1
	}
	if queueDepth < 1 {
		queueDepth = 32
	}
	pq := &ProbeQueue{
		db:        db,
		hub:       hub,
		mediaPath: mediaPath,
		jobs:      make(chan probeJob, queueDepth),
	}
	for i := 0; i < workers; i++ {
		go pq.worker(i)
	}
	log.Printf("probe queue: %d worker(s), depth %d", workers, queueDepth)
	return pq
}

// Submit enqueues a probe job. Blocks if the queue is full (natural backpressure
// — better than dropping silently and leaving the row with NULL metadata forever).
func (pq *ProbeQueue) Submit(v models.Video) {
	pq.jobs <- probeJob{VideoID: v.ID, Path: v.Path}
}

func (pq *ProbeQueue) worker(id int) {
	for job := range pq.jobs {
		pq.run(job)
	}
}

func (pq *ProbeQueue) run(job probeJob) {
	duration, resolution, videoCodec, audioCodec, format, streamCopy, err := ffmpegworker.ProbeVideo(job.Path)
	thumbPath := ffmpegworker.GetThumbnailPath(pq.mediaPath, job.VideoID)
	_ = ffmpegworker.GenerateThumbnail(job.Path, thumbPath)

	if err != nil {
		duration = 0
		videoCodec = "unknown"
		audioCodec = "unknown"
		log.Printf("probe failed for %s: %v", job.VideoID, err)
	}

	if _, dbErr := pq.db.Exec(`
		UPDATE videos SET duration=$1, resolution=$2, video_codec=$3, audio_codec=$4,
			format=$5, stream_copy=$6, thumbnail_path=$7 WHERE id=$8`,
		duration, resolution, videoCodec, audioCodec, format, streamCopy,
		"/media/thumbnails/"+job.VideoID+".jpg", job.VideoID,
	); dbErr != nil {
		log.Printf("probe queue: db update %s: %v", job.VideoID, dbErr)
		return
	}

	var v models.Video
	if err := pq.db.Get(&v, `SELECT * FROM videos WHERE id = $1`, job.VideoID); err == nil {
		pq.hub.Broadcast("video:updated", v)
	}
}
