import type { LoadSampleResponse, NcrListResponse, RemoveSampleResponse } from '../server/contract.ts';

async function request<T>(path: string, method = 'GET'): Promise<T> {
  const response = await fetch(path, { method });
  if (!response.ok) throw new Error(`${method} ${path} failed with status ${response.status}`);
  return (await response.json()) as T;
}

export const listNcrs = () => request<NcrListResponse>('/api/ncrs');
export const loadSample = () => request<LoadSampleResponse>('/api/sample', 'POST');
export const removeSample = () => request<RemoveSampleResponse>('/api/sample', 'DELETE');
