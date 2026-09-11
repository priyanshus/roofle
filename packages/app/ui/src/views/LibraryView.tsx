import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSessions } from '../api/client';
import { AlertIcon, ChevronIcon, LibraryIcon, SpinnerIcon } from '../components/Icons';
import type { SessionSummary } from '../types';

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Local calendar-day key (YYYY-MM-DD) used for grouping and collapse identity.
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Human label for a day group: "Today", "Yesterday", or a short date.
function dayLabel(key: string): string {
  if (key === 'unknown') return 'Unknown date';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((startOfToday.getTime() - date.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

// Builds a readable, shareable session URL: a slugified "title + date-time"
// followed by the real session id as a tail segment, so the server can recover
// it. E.g. /sessions/negotiating-q3-pricing-2026-09-11-07-50-conv-123
function sessionUrl(s: SessionSummary): string {
  const label = s.title || 'conversation';
  const date = new Date(s.startedAt);
  const datePart = Number.isNaN(date.getTime())
    ? 'unknown'
    : date.toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const slug = `${label} ${datePart}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return `/sessions/${encodeURIComponent(`${slug}-${s.sessionId}`)}`;
}

export default function LibraryView() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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

  // Group sessions by calendar day, most recent first. Collapse defaults: only
  // today is expanded; every other day starts collapsed.
  const groups = useMemo(() => {
    if (!sessions) return [];
    const byDay = new Map<string, SessionSummary[]>();
    for (const s of sessions) {
      const key = dayKey(s.startedAt);
      const list = byDay.get(key) ?? [];
      list.push(s);
      byDay.set(key, list);
    }
    return Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, items]) => ({
        key,
        label: dayLabel(key),
        items: items.sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      }));
  }, [sessions]);

  if (error) {
    return (
      <div className="content">
        <div className="empty-state">
          <div className="icon">
            <AlertIcon size={30} />
          </div>
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
          <div className="icon">
            <SpinnerIcon size={30} />
          </div>
          <div className="title">Loading conversations…</div>
        </div>
      </div>
    );
  }

  const toggle = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !(prev[key] ?? key !== dayKey(new Date().toISOString())) }));

  return (
    <div className="content">
      <div className="section-head">
        <h2>Conversations</h2>
        <span className="count">{sessions.length}</span>
      </div>

      {sessions.length === 0 ? (
        <div className="empty-state">
          <div className="icon">
            <LibraryIcon size={30} />
          </div>
          <div className="title">No conversations yet</div>
          <div className="hint">Past sessions will appear here after you capture audio.</div>
          <Link to="/" className="btn empty-action">
            Start a capture
          </Link>
        </div>
      ) : (
        <div className="library-groups">
          {groups.map((group) => {
            const isCollapsed = collapsed[group.key] ?? group.key !== dayKey(new Date().toISOString());
            return (
              <section key={group.key} className="library-group">
                <button
                  type="button"
                  className="library-group-head"
                  onClick={() => toggle(group.key)}
                  aria-expanded={!isCollapsed}
                >
                  <ChevronIcon open={!isCollapsed} />
                  <span className="library-group-label">{group.label}</span>
                  <span className="count">{group.items.length}</span>
                </button>
                {!isCollapsed && (
                  <div className="session-list">
                    {group.items.map((s) => (
                      <Link key={s.sessionId} to={sessionUrl(s)} className="session-card">
                        <div className="session-title">{s.title || formatTime(s.startedAt)}</div>
                        <div className="session-meta">
                          <span>{formatTime(s.startedAt)}</span>
                          <span>{s.questionCount} questions</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
