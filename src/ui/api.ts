import type {
  ImportCommitResponse,
  ImportPreviewResponse,
  ImportRequest,
  LoadSampleResponse,
  NcrListResponse,
  RemoveImportResponse,
  RemoveSampleResponse,
} from '../server/contract.ts';

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    // The backend explains refusals in plain words; show that when it is there.
    let message = `${method} ${path} failed with status ${response.status}`;
    try {
      const data = (await response.json()) as { error?: unknown };
      if (typeof data.error === 'string') message = data.error;
    } catch {
      // not JSON; keep the generic message
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export const listNcrs = () => request<NcrListResponse>('/api/ncrs');
export const loadSample = () => request<LoadSampleResponse>('/api/sample', 'POST');
export const removeSample = () => request<RemoveSampleResponse>('/api/sample', 'DELETE');
export const previewImport = (body: ImportRequest) => request<ImportPreviewResponse>('/api/import/preview', 'POST', body);
export const commitImport = (body: ImportRequest) => request<ImportCommitResponse>('/api/import/commit', 'POST', body);
export const removeImport = (id: number) => request<RemoveImportResponse>(`/api/imports/${id}`, 'DELETE');
