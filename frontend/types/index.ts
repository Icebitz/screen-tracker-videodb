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
  working_history?: WorkingHistorySummaryPayload;
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
  workingHistory?: WorkingHistorySummary;
  raw: CaptureSession;
};

export type WorkingHistoryEntryPayload = {
  source_log_id?: string;
  source_action_type?: string;
  start?: number;
  end?: number;
  start_label?: string;
  end_label?: string;
  app?: string;
  action?: string;
  line?: string;
};

export type WorkingHistorySummaryPayload = {
  session_id?: string;
  generated_at?: string | null;
  source_log_count?: number;
  entry_count?: number;
  file_path?: string | null;
  json_path?: string | null;
  entries?: WorkingHistoryEntryPayload[];
  lines?: string[];
};

export type WorkingHistoryEntry = {
  sourceLogId?: string;
  sourceActionType?: string;
  start?: number;
  end?: number;
  startLabel: string;
  endLabel: string;
  app: string;
  action: string;
  line: string;
};

export type WorkingHistorySummary = {
  sessionId?: string;
  generatedAt?: string;
  sourceLogCount: number;
  entryCount: number;
  filePath?: string;
  jsonPath?: string;
  entries: WorkingHistoryEntry[];
  lines: string[];
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
  working_history?: WorkingHistorySummaryPayload;
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
