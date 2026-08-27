import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSessions } from '../api/client';
import type { SessionSummary } from '../types';

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function LibraryView() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSessions()
      .then(({ sessions }) => {
        if (!cancelled) setSessions(sessions);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load sessions');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="content">
        <div className="empty-state">
          <div className="icon">⚠️</div>
          <div className="title">Failed to load</div>
          <div className="hint">{error}</div>
        </div>
      </div>
    );
  }

  if (sessions === null) {
    return (
      <div className="content">
        <div className="empty-state">
          <div className="icon">⏳</div>
          <div className="title">Loading conversations…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      <div className="section-head">
        <h2>📚 Conversations</h2>
        <span className="count">{sessions.length}</span>
      </div>

      {sessions.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🗂️</div>
          <div className="title">No conversations yet</div>
          <div className="hint">Past sessions will appear here after you capture audio.</div>
        </div>
      ) : (
        <div className="session-list">
          {sessions.map((s) => (
            <Link key={s.sessionId} to={`/sessions/${encodeURIComponent(s.sessionId)}`} className="session-card">
              <div className="session-title">{formatTime(s.startedAt)}</div>
              <div className="session-meta">
                <span>{s.questionCount} questions</span>
                <span className="session-id">{s.sessionId}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
