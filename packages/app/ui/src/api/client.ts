import type { CaptureState, MeetingAnalysis, Persona, SessionDetail, SessionSummary } from '../types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
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

export function fetchMeetingAnalyses(): Promise<{ analyses: MeetingAnalysis[] }> {
  return getJson('/api/meetings');
}

export function fetchMeetingAnalysis(
  sessionId: string,
  persona?: string,
  personaContext?: string
): Promise<{ analysis: MeetingAnalysis }> {
  const params = new URLSearchParams();
  if (persona) params.set('persona', persona);
  if (personaContext) params.set('personaContext', personaContext);
  const qs = params.toString();
  return getJson(
    `/api/meetings/${encodeURIComponent(sessionId)}${qs ? `?${qs}` : ''}`
  );
}

export function analyzeMeeting(
  sessionId: string,
  persona?: string,
  personaContext?: string
): Promise<{ analysis: MeetingAnalysis }> {
  return postJson(`/api/meetings/${encodeURIComponent(sessionId)}`, {
    persona,
    personaContext,
  });
}

export function fetchPersonas(): Promise<{ personas: Persona[] }> {
  return getJson('/api/personas');
}

export function fetchCaptureState(): Promise<{ state: CaptureState; sessionId: string }> {
  return getJson('/api/capture/state');
}

export function startCapture(): Promise<{ state: CaptureState }> {
  return postJson('/api/capture/start');
}

export function stopCapture(): Promise<{ state: CaptureState }> {
  return postJson('/api/capture/stop');
}

export function pauseCapture(): Promise<{ state: CaptureState }> {
  return postJson('/api/capture/pause');
}

export function resumeCapture(): Promise<{ state: CaptureState }> {
  return postJson('/api/capture/resume');
}

export function newSession(): Promise<{ state: CaptureState; sessionId: string }> {
  return postJson('/api/capture/session');
}
