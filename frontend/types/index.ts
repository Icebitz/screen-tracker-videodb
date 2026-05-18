export type RecordingMetadata = Record<string, unknown> & {
  app?: string;
  title?: string;
  user?: string;
};

export type CaptureSession = {
  id?: string;
  session_id?: string;
  capture_session_id?: string;
  status?: string;
  start_time?: string;
  started_at?: string;
  created_at?: string;
  end_time?: string;
  ended_at?: string;
  duration?: number;
  metadata?: RecordingMetadata;
  playback_url?: string;
  video_url?: string;
  stream_url?: string;
  player_url?: string;
  hls_url?: string;
};

export type Recording = {
  id: string;
  title: string;
  status: string;
  startedAt?: string;
  endedAt?: string;
  duration?: number;
  metadata: RecordingMetadata;
  videoUrl?: string;
  raw: CaptureSession;
};

export type CaptureStartResponse = {
  session_id: string;
  client_token?: string;
  collection_id?: string;
  client_id?: string;
};

export type ClientLog = {
  id: string;
  ts: string;
  level: string;
  source: string;
  session_id?: string | null;
  client_id?: string | null;
  action_type?: string | null;
  message: string;
  payload?: unknown;
};

export type ClearCollectionResponse = {
  old_collection_id: string;
  new_collection_id: string;
};

export type FinalizeRecordingResponse = {
  session_id: string;
  recording?: CaptureSession;
  export?: {
    video_id?: string;
    stream_url?: string;
    player_url?: string;
    name?: string;
    duration?: number;
  };
  indexing?: unknown;
};

export type SearchResult = {
  id?: string;
  start?: number;
  start_time?: number | string;
  end?: number;
  end_time?: number | string;
  text?: string;
  description?: string;
  score?: number;
  confidence?: number;
  thumbnail?: string;
  session_id?: string;
  capture_session_id?: string;
};

export type NormalizedSearchResult = {
  id: string;
  sessionId?: string;
  start?: number;
  end?: number;
  text: string;
  score?: number;
  thumbnail?: string;
  raw: SearchResult;
};
