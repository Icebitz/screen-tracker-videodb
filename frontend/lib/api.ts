import axios, { AxiosError } from "axios";
import type {
  CaptureSession,
  CaptureStartResponse,
  ClearCollectionResponse,
  ClientLog,
  FinalizeRecordingResponse,
  NormalizedSearchResult,
  Recording,
  RecordingMetadata,
  SearchResult,
  WorkingHistoryEntry,
  WorkingHistorySummary,
  WorkingHistorySummaryPayload,
} from "@/types";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000",
  timeout: 30000,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringValue = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
};

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const arrayFromPayload = <T>(payload: unknown): T[] => {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (!isRecord(payload)) {
    return [];
  }

  const candidates = [
    payload.recordings,
    payload.sessions,
    payload.capture_sessions,
    payload.results,
    payload.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as T[];
    }
  }

  return [];
};

export const getRecordingId = (recording: CaptureSession): string =>
  stringValue(recording.id) ||
  stringValue(recording.session_id) ||
  stringValue(recording.capture_session_id) ||
  "";

export const getRecordingVideoUrl = (recording: CaptureSession): string | undefined =>
  stringValue(recording.playback_url) ||
  stringValue(recording.video_url) ||
  stringValue(recording.stream_url) ||
  stringValue(recording.player_url) ||
  stringValue(recording.hls_url);

export const getRecordingTitle = (recording: CaptureSession): string => {
  const metadata = recording.metadata ?? {};
  return (
    stringValue(metadata.title) ||
    stringValue(metadata.app) ||
    stringValue(recording.id) ||
    stringValue(recording.session_id) ||
    "Screen session"
  );
};

const normalizeWorkingHistory = (
  summary: unknown,
): WorkingHistorySummary | undefined => {
  if (!isRecord(summary)) {
    return undefined;
  }

  const payload = summary as WorkingHistorySummaryPayload;
  const entries: WorkingHistoryEntry[] = Array.isArray(payload.entries)
    ? payload.entries.map((entry) => {
        const startLabel = stringValue(entry.start_label) || "Unknown";
        const endLabel = stringValue(entry.end_label) || startLabel;
        const app = stringValue(entry.app) || "Screen";
        const action = stringValue(entry.action) || "Activity recorded";
        const line =
          stringValue(entry.line) ||
          `[${startLabel} - ${endLabel}]: [${app}] : ${action}`;

        return {
          sourceLogId: stringValue(entry.source_log_id),
          sourceActionType: stringValue(entry.source_action_type),
          start: numberValue(entry.start),
          end: numberValue(entry.end),
          startLabel,
          endLabel,
          app,
          action,
          line,
        };
      })
    : [];

  return {
    sessionId: stringValue(payload.session_id),
    generatedAt: stringValue(payload.generated_at),
    sourceLogCount: numberValue(payload.source_log_count) || 0,
    entryCount: numberValue(payload.entry_count) || entries.length,
    filePath: stringValue(payload.file_path),
    jsonPath: stringValue(payload.json_path),
    entries,
    lines: Array.isArray(payload.lines)
      ? payload.lines.map(String)
      : entries.map((entry) => entry.line),
  };
};

export const normalizeRecording = (recording: CaptureSession): Recording | null => {
  const id = getRecordingId(recording);

  if (!id) {
    return null;
  }

  const metadata: RecordingMetadata = recording.metadata ?? {};

  return {
    id,
    title: getRecordingTitle(recording),
    status: stringValue(recording.status) || "processing",
    startedAt:
      stringValue(recording.start_time) ||
      stringValue(recording.started_at) ||
      stringValue(recording.created_at),
    endedAt: stringValue(recording.end_time) || stringValue(recording.ended_at),
    duration: numberValue(recording.duration),
    metadata,
    videoUrl: getRecordingVideoUrl(recording),
    workingHistory: normalizeWorkingHistory(recording.working_history),
    raw: recording,
  };
};

export const normalizeSearchResult = (
  result: SearchResult,
  index: number,
): NormalizedSearchResult => {
  const sessionId =
    stringValue(result.session_id) || stringValue(result.capture_session_id);

  return {
    id: stringValue(result.id) || `${sessionId || "result"}-${index}`,
    sessionId,
    start: numberValue(result.start) || numberValue(result.start_time),
    end: numberValue(result.end) || numberValue(result.end_time),
    text:
      stringValue(result.text) ||
      stringValue(result.description) ||
      "No transcript text returned.",
    score: numberValue(result.score) || numberValue(result.confidence),
    thumbnail: stringValue(result.thumbnail),
    raw: result,
  };
};

export const getApiErrorMessage = (
  error: unknown,
  fallback = "Request failed.",
): string => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ detail?: string; message?: string }>;
    return (
      axiosError.response?.data?.detail ||
      axiosError.response?.data?.message ||
      axiosError.message ||
      fallback
    );
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
};

export const startCapture = async (
  clientId?: string,
): Promise<CaptureStartResponse> => {
  const { data } = await api.get<CaptureStartResponse>("/api/start-capture", {
    params: clientId ? { client_id: clientId } : undefined,
  });
  return data;
};

export const getRecordings = async (): Promise<Recording[]> => {
  const { data } = await api.get<unknown>("/api/recordings");
  return arrayFromPayload<CaptureSession>(data)
    .map(normalizeRecording)
    .filter((recording): recording is Recording => recording !== null);
};

export const getClientLogs = async (): Promise<ClientLog[]> => {
  const { data } = await api.get<{ logs?: ClientLog[] }>("/api/client-logs");
  return data.logs ?? [];
};

export const clearClientLogs = async (): Promise<void> => {
  await api.delete("/api/client-logs");
};

export const clearCollection = async (): Promise<ClearCollectionResponse> => {
  const { data } = await api.post<ClearCollectionResponse>("/api/collection/clear");
  return data;
};

export const getRecording = async (sessionId: string): Promise<Recording | null> => {
  try {
    const { data } = await api.get<CaptureSession>(`/api/recordings/${sessionId}`);
    return normalizeRecording(data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status !== 404) {
      throw error;
    }
  }

  const recordings = await getRecordings();
  return recordings.find((recording) => recording.id === sessionId) ?? null;
};

export const finalizeRecording = async (
  sessionId: string,
): Promise<Recording | null> => {
  const { data } = await api.post<FinalizeRecordingResponse>(
    `/api/recordings/${sessionId}/finalize`,
  );

  if (data.recording) {
    return normalizeRecording(data.recording);
  }

  return getRecording(sessionId);
};

export const searchContent = async (
  query: string,
): Promise<NormalizedSearchResult[]> => {
  const { data } = await api.post<unknown>("/api/search", { query });
  return arrayFromPayload<SearchResult>(data).map(normalizeSearchResult);
};
