export interface Video {
  id: string;
  filename: string;
  orig_name: string;
  path: string;
  size: number;
  duration: number;
  resolution: string | null;
  format: string | null;
  video_codec: string | null;
  audio_codec: string | null;
  stream_copy: boolean;
  thumbnail_path: string | null;
  created_at: string;
}

export interface Stream {
  id: string;
  name: string;
  rtmp_url: string;
  stream_key: string;
  status: "idle" | "starting" | "live" | "stopping" | "error";
  resolution: string;
  fps: number;
  bitrate: number;
  audio_bitrate: number;
  preset: string;
  overlay_enabled: boolean;
  overlay_logo_path: string | null;
  overlay_logo_pos: string;
  overlay_logo_size: number;
  overlay_logo_opacity: number;
  overlay_text: string | null;
  overlay_text_pos: string;
  overlay_text_size: number;
  audio_normalize: boolean;
  stealth_hflip: boolean;
  stealth_speed: number;
  stealth_hue: number;
  loop_mode: boolean;
  shuffle_mode: boolean;
  current_video_id: string | null;
  started_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueueItem {
  id: string;
  stream_id: string;
  video_id: string;
  position: number;
  created_at: string;
  video?: Video;
}

export interface QueueSettings {
  loop_mode: boolean;
  shuffle_mode: boolean;
}

export interface DashboardStats {
  total_streams: number;
  live_streams: number;
  total_videos: number;
  total_video_size: number;
  cpu: number;
  ram: number;
  ws_clients: number;
}

export interface StreamStats {
  stream_id: string;
  bitrate: number;
  fps?: number;
  speed?: number;
  cpu: number;
  ram: number;
  uptime?: number;
}

export type StreamEventType =
  | "started"
  | "stopped"
  | "crashed"
  | "video_changed"
  | "error"
  | "scene_started";

export interface StreamEvent {
  id: number;
  stream_id: string;
  type: StreamEventType;
  message: string;
  video_id?: string | null;
  created_at: string;
}

export type WSMessage =
  | { type: "stream:status"; payload: { stream_id: string; status: Stream["status"]; current_video?: Video } }
  | { type: "stream:stats"; payload: StreamStats }
  | { type: "stream:event"; payload: { stream_id: string; type: StreamEventType; message: string; video_id?: string | null } }
  | { type: "stream:created"; payload: Stream }
  | { type: "stream:updated"; payload: Stream }
  | { type: "stream:deleted"; payload: { id: string } }
  | { type: "video:uploaded"; payload: Video }
  | { type: "video:updated"; payload: Video }
  | { type: "video:deleted"; payload: { id: string } };
