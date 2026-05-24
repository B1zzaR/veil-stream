package ffmpeg

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"math/rand"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"veil/internal/models"
	"veil/internal/ws"

	"github.com/jmoiron/sqlx"
)

// Process represents a running FFmpeg session for one stream.
type Process struct {
	StreamID  string
	cmd       *exec.Cmd
	cancel    context.CancelFunc // cancels the *loop*, not just the current FFmpeg invocation
	startedAt time.Time
	restarts  int
	bitrate   float64
	fps       float64
	speed     float64
	mu        sync.Mutex
}

func (p *Process) Stats() (bitrate, fps, speed float64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.bitrate, p.fps, p.speed
}

type Worker struct {
	db        *sqlx.DB
	hub       *ws.Hub
	processes map[string]*Process
	mu        sync.RWMutex
	mediaPath string

	// rootCtx ties every running stream to the application's lifecycle so a
	// graceful shutdown cancels them all.
	rootCtx    context.Context
	rootCancel context.CancelFunc
}

func NewWorker(db *sqlx.DB, hub *ws.Hub, mediaPath string) *Worker {
	ctx, cancel := context.WithCancel(context.Background())
	return &Worker{
		db:         db,
		hub:        hub,
		processes:  make(map[string]*Process),
		mediaPath:  mediaPath,
		rootCtx:    ctx,
		rootCancel: cancel,
	}
}

// Start resumes streams that were live before a restart.
func (w *Worker) Start(parent context.Context) {
	// Replace rootCtx with one derived from the parent so cancellation propagates.
	w.rootCtx, w.rootCancel = context.WithCancel(parent)

	var streamIDs []string
	err := w.db.SelectContext(w.rootCtx, &streamIDs,
		`SELECT id FROM streams WHERE status = $1 OR status = $2`,
		models.StatusLive, models.StatusStarting)
	if err == nil {
		for _, id := range streamIDs {
			log.Printf("ffmpeg: resuming stream %s", id)
			_ = w.StartStream(w.rootCtx, id)
		}
	}
}

// Shutdown cancels every running stream and waits up to 5s for them to exit.
func (w *Worker) Shutdown() {
	log.Printf("ffmpeg: shutdown, stopping %d streams", w.activeCount())
	w.mu.Lock()
	for _, p := range w.processes {
		p.cancel()
	}
	w.mu.Unlock()
	w.rootCancel()

	// Best-effort wait — runStream sets status idle as it returns.
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if w.activeCount() == 0 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	// Mark anything left as idle so the next boot doesn't auto-resume.
	_, _ = w.db.Exec(`UPDATE streams SET status='idle', current_video_id=NULL, started_at=NULL WHERE status IN ('live','starting')`)
}

func (w *Worker) activeCount() int {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return len(w.processes)
}

// IsRunning reports whether a stream has an active process.
func (w *Worker) IsRunning(streamID string) bool {
	w.mu.RLock()
	defer w.mu.RUnlock()
	_, ok := w.processes[streamID]
	return ok
}

// StartStream registers a process and kicks off the loop.
func (w *Worker) StartStream(parent context.Context, streamID string) error {
	w.mu.Lock()
	if _, exists := w.processes[streamID]; exists {
		w.mu.Unlock()
		return fmt.Errorf("поток уже запущен")
	}

	// One context per stream — covers the whole loop including backoff.
	ctx, cancel := context.WithCancel(w.rootCtx)
	proc := &Process{
		StreamID:  streamID,
		cancel:    cancel,
		startedAt: time.Now(),
	}
	w.processes[streamID] = proc
	w.mu.Unlock()

	if err := w.setStatus(streamID, models.StatusStarting, nil); err != nil {
		w.mu.Lock()
		delete(w.processes, streamID)
		w.mu.Unlock()
		cancel()
		return err
	}

	w.logEvent(streamID, models.EventStarted, "трансляция запущена", nil)
	go w.runStream(ctx, proc)
	return nil
}

// StopStream cancels the loop and clears state.
func (w *Worker) StopStream(streamID string) {
	w.mu.Lock()
	p, ok := w.processes[streamID]
	if ok {
		p.cancel()
		delete(w.processes, streamID)
	}
	w.mu.Unlock()

	_ = w.setStatus(streamID, models.StatusIdle, nil)
	if ok {
		w.logEvent(streamID, models.EventStopped, "трансляция остановлена", nil)
	}
	w.hub.Broadcast("stream:status", map[string]interface{}{
		"stream_id": streamID,
		"status":    models.StatusIdle,
	})
}

// RestartStream stops + starts atomically.
func (w *Worker) RestartStream(parent context.Context, streamID string) error {
	w.StopStream(streamID)
	// Brief settle so the RTMP endpoint releases.
	time.Sleep(1500 * time.Millisecond)
	return w.StartStream(parent, streamID)
}

func (w *Worker) runStream(ctx context.Context, proc *Process) {
	const maxRestarts = 20
	defer func() {
		w.mu.Lock()
		if w.processes[proc.StreamID] == proc {
			delete(w.processes, proc.StreamID)
		}
		w.mu.Unlock()
	}()

	streamID := proc.StreamID

	for {
		if ctx.Err() != nil {
			return
		}

		stream, err := w.fetchStream(streamID)
		if err != nil {
			log.Printf("ffmpeg: cannot fetch stream %s: %v", streamID, err)
			_ = w.setStatus(streamID, models.StatusError, nil)
			w.logEvent(streamID, models.EventError, "не удалось загрузить трансляцию: "+err.Error(), nil)
			return
		}

		video, err := w.nextVideo(stream)
		if err != nil {
			log.Printf("ffmpeg: no video for stream %s: %v", streamID, err)
			_ = w.setStatus(streamID, models.StatusIdle, nil)
			w.logEvent(streamID, models.EventStopped, "очередь пуста — трансляция остановлена", nil)
			w.hub.Broadcast("stream:status", map[string]interface{}{
				"stream_id": streamID,
				"status":    models.StatusIdle,
			})
			return
		}

		now := time.Now()
		_ = w.setStatus(streamID, models.StatusLive, &video.ID)
		if _, err := w.db.Exec(`UPDATE streams SET started_at = COALESCE(started_at, $1) WHERE id = $2`, now, streamID); err != nil {
			log.Printf("ffmpeg: update started_at: %v", err)
		}

		proc.mu.Lock()
		proc.restarts = 0
		proc.mu.Unlock()

		w.logEvent(streamID, models.EventVideoChanged, "→ "+video.OrigName, &video.ID)
		w.hub.Broadcast("stream:status", map[string]interface{}{
			"stream_id":     streamID,
			"status":        models.StatusLive,
			"current_video": video,
		})

		exitCode := w.runFFmpeg(ctx, proc, stream, video)

		if ctx.Err() != nil {
			return
		}

		if exitCode == 0 {
			// Video finished normally → advance queue.
			if err := w.advanceQueue(stream); err != nil {
				log.Printf("ffmpeg: advance queue: %v", err)
				_ = w.setStatus(streamID, models.StatusIdle, nil)
				w.logEvent(streamID, models.EventStopped, "ошибка в очереди: "+err.Error(), nil)
				return
			}
			continue
		}

		// FFmpeg crashed → exponential backoff with cap.
		proc.mu.Lock()
		proc.restarts++
		restarts := proc.restarts
		proc.mu.Unlock()

		if restarts > maxRestarts {
			log.Printf("ffmpeg: stream %s exceeded max restarts", streamID)
			_ = w.setStatus(streamID, models.StatusError, nil)
			w.logEvent(streamID, models.EventError, fmt.Sprintf("превышено число перезапусков (%d) — стрим остановлен", maxRestarts), nil)
			w.hub.Broadcast("stream:status", map[string]interface{}{
				"stream_id": streamID,
				"status":    models.StatusError,
			})
			return
		}

		backoff := time.Duration(restarts*5) * time.Second
		if backoff > 60*time.Second {
			backoff = 60 * time.Second
		}
		log.Printf("ffmpeg: stream %s crashed (exit %d), restart %d/%d in %s", streamID, exitCode, restarts, maxRestarts, backoff)
		w.logEvent(streamID, models.EventCrashed, fmt.Sprintf("FFmpeg вышел с кодом %d, перезапуск через %s", exitCode, backoff), nil)

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
	}
}

func (w *Worker) runFFmpeg(ctx context.Context, proc *Process, stream *models.Stream, video *models.Video) int {
	args := buildArgs(stream, video)
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)

	proc.mu.Lock()
	proc.cmd = cmd
	proc.mu.Unlock()

	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		log.Printf("ffmpeg: start failed: %v", err)
		return 1
	}

	go parseFfmpegOutput(stderr, proc)

	statsCtx, stopStats := context.WithCancel(ctx)
	go w.statsLoop(statsCtx, proc, stream.ID)

	err := cmd.Wait()
	stopStats()

	if ctx.Err() != nil {
		return 0
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode()
	}
	if err != nil {
		return 1
	}
	return 0
}

func (w *Worker) statsLoop(ctx context.Context, proc *Process, streamID string) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cpu, ram := GetSysStats()
			bitrate, fps, speed := proc.Stats()
			w.hub.Broadcast("stream:stats", map[string]interface{}{
				"stream_id": streamID,
				"bitrate":   bitrate,
				"fps":       fps,
				"speed":     speed,
				"cpu":       cpu,
				"ram":       ram,
				"uptime":    int64(time.Since(proc.startedAt).Seconds()),
			})
		}
	}
}

// parseFfmpegOutput scans FFmpeg's progress lines (`frame= ... fps= ... bitrate= ... speed=`).
func parseFfmpegOutput(r io.Reader, proc *Process) {
	scanner := bufio.NewScanner(r)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		bitrate, hasBitrate := parseProgressValue(line, "bitrate=", "kbits/s")
		fps, hasFps := parseProgressValue(line, "fps=", "")
		speed, hasSpeed := parseProgressValue(line, "speed=", "x")
		if hasBitrate || hasFps || hasSpeed {
			proc.mu.Lock()
			if hasBitrate {
				proc.bitrate = bitrate
			}
			if hasFps {
				proc.fps = fps
			}
			if hasSpeed {
				proc.speed = speed
			}
			proc.mu.Unlock()
		}
	}
}

func parseProgressValue(line, prefix, suffix string) (float64, bool) {
	idx := strings.Index(line, prefix)
	if idx == -1 {
		return 0, false
	}
	rest := line[idx+len(prefix):]
	end := strings.IndexAny(rest, " \t")
	if end == -1 {
		end = len(rest)
	}
	valStr := strings.TrimSuffix(strings.TrimSpace(rest[:end]), suffix)
	v, err := strconv.ParseFloat(valStr, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

// derefStr safely dereferences a *string, returning "" if nil.
func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func buildArgs(s *models.Stream, v *models.Video) []string {
	rtmpTarget := s.RTMPUrl + "/" + s.StreamKey

	args := []string{
		"-re",
		"-i", v.Path,
		"-hide_banner",
		"-loglevel", "warning",
		"-stats",
	}

	logoPath := derefStr(s.OverlayLogoPath)
	overlayText := derefStr(s.OverlayText)

	if v.StreamCopy && !s.OverlayEnabled {
		args = append(args,
			"-c:v", "copy",
			"-c:a", "copy",
		)
	} else {
		w, h := parseResolution(s.Resolution)
		scaleFilter := fmt.Sprintf(
			"scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2",
			w, h, w, h,
		)

		if s.OverlayEnabled && logoPath != "" {
			args = append(args, "-i", logoPath)
			logoPos := overlayPosition(s.OverlayLogoPos)

			// Clamp size factor (10–500 %) and opacity (0.0–1.0).
			sizeFactor := float64(s.OverlayLogoSize) / 100.0
			if sizeFactor < 0.1 {
				sizeFactor = 0.1
			} else if sizeFactor > 5.0 {
				sizeFactor = 5.0
			}
			opacity := s.OverlayLogoOpacity
			if opacity < 0 {
				opacity = 0
			} else if opacity > 1 {
				opacity = 1
			}

			// Logo sub-filter: scale to requested size, then apply opacity via
			// colorchannelmixer (multiplies the alpha channel).
			logoFilter := fmt.Sprintf("[1:v]scale=iw*%.4f:-2[logo_s];[logo_s]format=rgba,colorchannelmixer=aa=%.4f[logo_f]",
				sizeFactor, opacity)

			filterComplex := fmt.Sprintf("[0:v]%s[scaled];%s;[scaled][logo_f]overlay=%s",
				scaleFilter, logoFilter, logoPos)
			if overlayText != "" {
				textPos := textPosition(s.OverlayTextPos)
				filterComplex += fmt.Sprintf(",drawtext=text='%s':fontcolor=white:fontsize=28:x=%s:y=%s:box=1:boxcolor=black@0.5:boxborderw=5",
					escapeFFmpegText(overlayText), textPos[0], textPos[1])
			}
			args = append(args, "-filter_complex", filterComplex)
		} else if s.OverlayEnabled && overlayText != "" {
			textPos := textPosition(s.OverlayTextPos)
			vf := fmt.Sprintf("%s,drawtext=text='%s':fontcolor=white:fontsize=28:x=%s:y=%s:box=1:boxcolor=black@0.5:boxborderw=5",
				scaleFilter, escapeFFmpegText(overlayText), textPos[0], textPos[1])
			args = append(args, "-vf", vf)
		} else {
			args = append(args, "-vf", scaleFilter)
		}

		args = append(args,
			"-c:v", "libx264",
			"-preset", s.Preset,
			"-tune", "zerolatency",
			"-b:v", fmt.Sprintf("%dk", s.Bitrate),
			"-maxrate", fmt.Sprintf("%dk", int(float64(s.Bitrate)*1.2)),
			"-bufsize", fmt.Sprintf("%dk", s.Bitrate*2),
			"-g", strconv.Itoa(s.FPS*2),
			"-keyint_min", strconv.Itoa(s.FPS),
			"-pix_fmt", "yuv420p",
			"-c:a", "aac",
			"-b:a", fmt.Sprintf("%dk", s.AudioBitrate),
			"-ar", "44100",
		)
	}

	args = append(args,
		"-f", "flv",
		rtmpTarget,
	)
	return args
}

func parseResolution(r string) (int, int) {
	parts := strings.SplitN(r, "x", 2)
	if len(parts) != 2 {
		return 1280, 720
	}
	w, _ := strconv.Atoi(parts[0])
	h, _ := strconv.Atoi(parts[1])
	if w == 0 || h == 0 {
		return 1280, 720
	}
	return w, h
}

func overlayPosition(pos string) string {
	switch pos {
	case "top-left":
		return "10:10"
	case "top-right":
		return "main_w-overlay_w-10:10"
	case "bottom-left":
		return "10:main_h-overlay_h-10"
	case "bottom-right":
		return "main_w-overlay_w-10:main_h-overlay_h-10"
	default:
		return "main_w-overlay_w-10:10"
	}
}

func textPosition(pos string) [2]string {
	switch pos {
	case "top-left":
		return [2]string{"10", "10"}
	case "top-right":
		return [2]string{"w-tw-10", "10"}
	case "bottom-left":
		return [2]string{"10", "h-th-10"}
	case "bottom-right":
		return [2]string{"w-tw-10", "h-th-10"}
	default:
		return [2]string{"10", "h-th-10"}
	}
}

func escapeFFmpegText(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "'", "\\'")
	s = strings.ReplaceAll(s, ":", "\\:")
	return s
}

func (w *Worker) fetchStream(id string) (*models.Stream, error) {
	var s models.Stream
	err := w.db.Get(&s, `SELECT * FROM streams WHERE id = $1`, id)
	return &s, err
}

func (w *Worker) nextVideo(s *models.Stream) (*models.Video, error) {
	if s.ShuffleMode {
		return w.randomVideo(s.ID)
	}
	return w.firstQueueVideo(s.ID)
}

func (w *Worker) firstQueueVideo(streamID string) (*models.Video, error) {
	var v models.Video
	err := w.db.Get(&v, `
		SELECT v.* FROM videos v
		JOIN queue_items q ON q.video_id = v.id
		WHERE q.stream_id = $1
		ORDER BY q.position ASC
		LIMIT 1
	`, streamID)
	return &v, err
}

func (w *Worker) randomVideo(streamID string) (*models.Video, error) {
	var ids []string
	err := w.db.Select(&ids, `SELECT video_id FROM queue_items WHERE stream_id = $1`, streamID)
	if err != nil || len(ids) == 0 {
		return nil, fmt.Errorf("empty queue")
	}
	chosen := ids[rand.Intn(len(ids))]
	var v models.Video
	err = w.db.Get(&v, `SELECT * FROM videos WHERE id = $1`, chosen)
	return &v, err
}

func (w *Worker) advanceQueue(s *models.Stream) error {
	tx, err := w.db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var first models.QueueItem
	if err := tx.Get(&first, `SELECT * FROM queue_items WHERE stream_id = $1 ORDER BY position ASC LIMIT 1`, s.ID); err != nil {
		return err
	}

	if s.LoopMode {
		var maxPos int
		_ = tx.Get(&maxPos, `SELECT COALESCE(MAX(position),0) FROM queue_items WHERE stream_id = $1`, s.ID)
		if _, err := tx.Exec(`UPDATE queue_items SET position = $1 WHERE id = $2`, maxPos+1, first.ID); err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(`DELETE FROM queue_items WHERE id = $1`, first.ID); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(`
		UPDATE queue_items SET position = sub.rn FROM (
			SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS rn
			FROM queue_items WHERE stream_id = $1
		) sub WHERE queue_items.id = sub.id
	`, s.ID); err != nil {
		return err
	}

	return tx.Commit()
}

func (w *Worker) setStatus(streamID, status string, videoID *string) error {
	if videoID != nil {
		_, err := w.db.Exec(
			`UPDATE streams SET status=$1, current_video_id=$2, updated_at=NOW() WHERE id=$3`,
			status, *videoID, streamID,
		)
		return err
	}
	_, err := w.db.Exec(
		`UPDATE streams SET status=$1, current_video_id=NULL, started_at=NULL, updated_at=NOW() WHERE id=$2`,
		status, streamID,
	)
	return err
}

// logEvent inserts a stream_event row and broadcasts it so listeners refresh.
func (w *Worker) logEvent(streamID, eventType, message string, videoID *string) {
	if _, err := w.db.Exec(
		`INSERT INTO stream_events (stream_id, type, message, video_id) VALUES ($1,$2,$3,$4)`,
		streamID, eventType, message, videoID,
	); err != nil {
		log.Printf("ffmpeg: logEvent: %v", err)
		return
	}
	w.hub.Broadcast("stream:event", map[string]interface{}{
		"stream_id": streamID,
		"type":      eventType,
		"message":   message,
		"video_id":  videoID,
	})
}

// GenerateThumbnail creates a thumbnail for a video at /media/thumbnails/<id>.jpg
func GenerateThumbnail(videoPath, outputPath string) error {
	cmd := exec.Command("ffmpeg",
		"-ss", "00:00:05",
		"-i", videoPath,
		"-vframes", "1",
		"-vf", "scale=320:-1",
		"-y",
		outputPath,
	)
	return cmd.Run()
}

// ProbeVideo extracts metadata from a video file using targeted ffprobe calls.
func ProbeVideo(path string) (duration float64, resolution, videoCodec, audioCodec, format string, streamCopy bool, err error) {
	// Video stream: codec_name,width,height
	vOut, _ := exec.Command("ffprobe",
		"-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "stream=codec_name,width,height",
		"-of", "csv=s=,:p=0",
		path,
	).Output()
	if line := strings.TrimSpace(string(vOut)); line != "" {
		parts := strings.Split(line, ",")
		if len(parts) >= 1 {
			videoCodec = parts[0]
		}
		if len(parts) >= 3 && parts[1] != "" && parts[2] != "" && parts[1] != "0" {
			resolution = parts[1] + "x" + parts[2]
		}
	}

	aOut, _ := exec.Command("ffprobe",
		"-v", "error",
		"-select_streams", "a:0",
		"-show_entries", "stream=codec_name",
		"-of", "csv=s=,:p=0",
		path,
	).Output()
	audioCodec = strings.TrimSpace(string(aOut))

	fOut, e := exec.Command("ffprobe",
		"-v", "error",
		"-show_entries", "format=duration,format_name",
		"-of", "csv=s=,:p=0",
		path,
	).Output()
	if e != nil {
		err = e
		return
	}
	if line := strings.TrimSpace(string(fOut)); line != "" {
		parts := strings.Split(line, ",")
		if len(parts) >= 1 {
			duration, _ = strconv.ParseFloat(parts[0], 64)
		}
		if len(parts) >= 2 {
			format = parts[1]
		}
	}

	streamCopy = strings.Contains(strings.ToLower(videoCodec), "h264") &&
		strings.Contains(strings.ToLower(audioCodec), "aac")
	return
}

// ---------- system stats (CPU + RAM) ----------

var (
	cpuMu       sync.Mutex
	prevIdle    uint64
	prevTotal   uint64
	prevSampled bool
)

// GetSysStats returns rolling CPU usage (% across all cores) and used RAM in bytes.
func GetSysStats() (cpu float64, ram uint64) {
	cpu = readCPUUsage()
	ram = readRAMUsage()
	return
}

// readCPUUsage samples /proc/stat and returns delta-based usage since the last call.
// First call returns 0 (no baseline). Falls back to loadavg if /proc/stat is unreadable.
func readCPUUsage() float64 {
	data, err := readFile("/proc/stat")
	if err != nil {
		return readLoadAvgFallback()
	}
	var user, nice, system, idle, iowait, irq, softirq, steal uint64
	for _, line := range strings.Split(data, "\n") {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 8 {
			break
		}
		user, _ = strconv.ParseUint(fields[1], 10, 64)
		nice, _ = strconv.ParseUint(fields[2], 10, 64)
		system, _ = strconv.ParseUint(fields[3], 10, 64)
		idle, _ = strconv.ParseUint(fields[4], 10, 64)
		iowait, _ = strconv.ParseUint(fields[5], 10, 64)
		irq, _ = strconv.ParseUint(fields[6], 10, 64)
		softirq, _ = strconv.ParseUint(fields[7], 10, 64)
		if len(fields) > 8 {
			steal, _ = strconv.ParseUint(fields[8], 10, 64)
		}
		break
	}

	idleAll := idle + iowait
	total := user + nice + system + idleAll + irq + softirq + steal

	cpuMu.Lock()
	defer cpuMu.Unlock()
	if !prevSampled {
		prevIdle = idleAll
		prevTotal = total
		prevSampled = true
		return 0
	}

	dTotal := total - prevTotal
	dIdle := idleAll - prevIdle
	prevTotal = total
	prevIdle = idleAll

	if dTotal == 0 {
		return 0
	}
	used := float64(dTotal-dIdle) / float64(dTotal) * 100
	if used < 0 {
		used = 0
	}
	if used > 100 {
		used = 100
	}
	return used
}

func readLoadAvgFallback() float64 {
	data, err := readFile("/proc/loadavg")
	if err != nil {
		return 0
	}
	parts := strings.Fields(data)
	if len(parts) == 0 {
		return 0
	}
	load, _ := strconv.ParseFloat(parts[0], 64)
	pct := load / 2.0 * 100
	if pct > 100 {
		pct = 100
	}
	return pct
}

func readRAMUsage() uint64 {
	data, err := readFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	var total, available uint64
	for _, line := range strings.Split(data, "\n") {
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		val, _ := strconv.ParseUint(parts[1], 10, 64)
		switch parts[0] {
		case "MemTotal:":
			total = val * 1024
		case "MemAvailable:":
			available = val * 1024
		}
	}
	if total == 0 {
		return 0
	}
	return total - available
}

// readFile is split out so tests can stub it; we avoid pulling in os.ReadFile
// directly in the hot path to keep the dependency footprint clear.
func readFile(path string) (string, error) {
	b, err := exec.Command("cat", path).Output()
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ---------- scenes ----------

// RunSceneFFmpeg starts a scene (starting-soon, pause, offline) loop.
func (w *Worker) RunSceneFFmpeg(ctx context.Context, streamID string, args []string) error {
	cmdCtx, cancel := context.WithCancel(ctx)

	w.mu.Lock()
	proc := &Process{StreamID: streamID, cancel: cancel, startedAt: time.Now()}
	w.processes[streamID] = proc
	w.mu.Unlock()

	defer func() {
		cancel()
		w.mu.Lock()
		if w.processes[streamID] == proc {
			delete(w.processes, streamID)
		}
		w.mu.Unlock()
		_ = w.setStatus(streamID, models.StatusIdle, nil)
	}()

	cmd := exec.CommandContext(cmdCtx, "ffmpeg", args...)
	proc.mu.Lock()
	proc.cmd = cmd
	proc.mu.Unlock()

	_ = w.setStatus(streamID, models.StatusLive, nil)
	w.logEvent(streamID, models.EventSceneStarted, "запущена сцена", nil)

	return cmd.Run()
}

func BuildSceneArgs(text, bgColor, resolution, rtmpURL, streamKey string, fps int) []string {
	w, h := 1280, 720
	if resolution == "1920x1080" {
		w, h = 1920, 1080
	} else if resolution == "854x480" {
		w, h = 854, 480
	}
	return []string{
		"-f", "lavfi",
		"-i", fmt.Sprintf("color=c=%s:s=%dx%d:r=%d", bgColor, w, h, fps),
		"-f", "lavfi",
		"-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
		"-vf", fmt.Sprintf("drawtext=text='%s':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=(h-text_h)/2",
			escapeFFmpegText(text)),
		"-c:v", "libx264",
		"-preset", "ultrafast",
		"-b:v", "1000k",
		"-c:a", "aac",
		"-b:a", "64k",
		"-f", "flv",
		rtmpURL + "/" + streamKey,
	}
}

// GetStreamPath returns the path to store uploaded video files.
func GetStreamPath(mediaPath, filename string) string {
	return filepath.Join(mediaPath, "uploads", filename)
}

func GetThumbnailPath(mediaPath, id string) string {
	return filepath.Join(mediaPath, "thumbnails", id+".jpg")
}
