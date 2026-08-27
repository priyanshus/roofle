import type { SessionDetail, SessionSummary } from '../types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function fetchSessions(): Promise<{ sessions: SessionSummary[] }> {
  return getJson('/api/sessions');
}

export function fetchSession(sessionId: string): Promise<{ session: SessionDetail }> {
  return getJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
}
