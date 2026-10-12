import type {
  ImportCommitResponse,
  ImportPreviewResponse,
  ImportRequest,
  LoadSampleResponse,
  NcrListResponse,
  RemoveImportResponse,
  RemoveSampleResponse,
  RemoveSummaryResponse,
  SummaryCheckRequest,
  SummaryCheckResponse,
  SummaryGenerateRequest,
  SummaryGenerateResponse,
} from '../server/contract.ts';

/** A refusal from the backend, with its reason code and any details it listed. */
export class ApiError extends Error {
  readonly code: string | null;
  readonly problems: string[];

  constructor(message: string, code: string | null = null, problems: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.problems = problems;
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method,
    signal,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    // The backend explains refusals in plain words; show that when it is there.
    let message = `${method} ${path} failed with status ${response.status}`;
    let code: string | null = null;
    let problems: string[] = [];
    try {
      const data = (await response.json()) as { error?: unknown; code?: unknown; problems?: unknown };
      if (typeof data.error === 'string') message = data.error;
      if (typeof data.code === 'string') code = data.code;
      if (Array.isArray(data.problems)) problems = data.problems.filter((p): p is string => typeof p === 'string');
    } catch {
      // not JSON; keep the generic message
    }
    throw new ApiError(message, code, problems);
  }
  return (await response.json()) as T;
}

export const listNcrs = () => request<NcrListResponse>('/api/ncrs');
export const loadSample = () => request<LoadSampleResponse>('/api/sample', 'POST');
export const removeSample = () => request<RemoveSampleResponse>('/api/sample', 'DELETE');
export const previewImport = (body: ImportRequest) => request<ImportPreviewResponse>('/api/import/preview', 'POST', body);
export const commitImport = (body: ImportRequest) => request<ImportCommitResponse>('/api/import/commit', 'POST', body);
export const removeImport = (id: number) => request<RemoveImportResponse>(`/api/imports/${id}`, 'DELETE');
export const checkSummary = (body: SummaryCheckRequest, signal?: AbortSignal) =>
  request<SummaryCheckResponse>('/api/summary/check', 'POST', body, signal);
export const generateSummary = (body: SummaryGenerateRequest, signal?: AbortSignal) =>
  request<SummaryGenerateResponse>('/api/summary', 'POST', body, signal);
export const removeSummary = (id: number) => request<RemoveSummaryResponse>(`/api/summary/${id}`, 'DELETE');
