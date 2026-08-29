import { useCallback, useEffect, useRef, useState } from 'react';
import {
  analyzeMeeting,
  fetchMeetingAnalysis,
  fetchMeetingAnalyses,
  fetchPersonas,
  fetchSessions,
} from '../api/client';
import type { MeetingAnalysis, Persona, SessionSummary } from '../types';

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function scoreColor(score: number): string {
  if (score >= 80) return 'good';
  if (score >= 50) return 'mid';
  return 'low';
}

function personaLabel(
  personas: Persona[],
  personaId?: string,
  contextId?: string
): string {
  if (!personaId) return 'General';
  const p = personas.find((x) => x.id === personaId);
  if (!p) return personaId;
  if (!contextId) return p.label;
  const c = p.contexts.find((x) => x.id === contextId);
  return c ? `${p.label} — ${c.label}` : p.label;
}

export default function MeetingView() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [analyses, setAnalyses] = useState<MeetingAnalysis[]>([]);
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(new Set());
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [selectedPersona, setSelectedPersona] = useState<string>('');
  const [selectedContext, setSelectedContext] = useState<string>('');
  const [analysis, setAnalysis] = useState<MeetingAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const activePersona = personas.find((p) => p.id === selectedPersona);
  const contexts = activePersona?.contexts ?? [];

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSessions(), fetchMeetingAnalyses(), fetchPersonas()])
      .then(([{ sessions: list }, { analyses }, { personas: pList }]) => {
        if (cancelled) return;
        setSessions(list);
        setAnalyses(analyses);
        setAnalyzedIds(new Set(analyses.map((a) => a.sessionId)));
        setPersonas(pList);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load data');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(
    (sessionId: string, persona?: string, personaContext?: string) => {
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const { analysis: next } = await fetchMeetingAnalysis(
            sessionId,
            persona,
            personaContext
          );
          setAnalysis(next);
          if (next.status === 'completed' || next.status === 'failed') {
            stopPolling();
          }
        } catch {
          // Keep polling; transient failures are retried.
        }
      }, 2000);
    },
    [stopPolling]
  );

  useEffect(() => stopPolling, [stopPolling]);

  const handleAnalyze = async () => {
    if (!selected) return;
    setError(null);
    setLoading(true);
    try {
      const { analysis: next } = await analyzeMeeting(
        selected,
        selectedPersona || undefined,
        selectedContext || undefined
      );
      setAnalysis(next);
      if (next.status === 'running' || next.status === 'pending') {
        poll(selected, next.persona, next.personaContext);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start analysis');
    } finally {
      setLoading(false);
    }
  };

  // Opens a previously analysed prompt, resuming polling when still running.
  const handleOpenAnalysis = (past: MeetingAnalysis) => {
    stopPolling();
    setError(null);
    setAnalysis(past);
    if (past.status === 'running' || past.status === 'pending') {
      poll(past.sessionId, past.persona, past.personaContext);
    }
  };

  const unanalyzed = sessions.filter((s) => !analyzedIds.has(s.sessionId));
  const options = selectedPersona
    ? sessions
    : unanalyzed;

  return (
    <div className="content">
      <div className="section-head">
        <h2>🤝 Meeting CoPilot</h2>
        <span className="count">Dashboard</span>
      </div>

      <section className="analyze-panel">
        <div className="analyze-row">
          <select
            className="session-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={loading}
          >
            <option value="">
              {selectedPersona ? 'Select a conversation…' : 'Select an unanalyzed conversation…'}
            </option>
            {options.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {formatTime(s.startedAt)} — {s.sessionId}
              </option>
            ))}
          </select>
        </div>

        <div className="analyze-row">
          <select
            className="persona-select"
            value={selectedPersona}
            onChange={(e) => {
              setSelectedPersona(e.target.value);
              setSelectedContext('');
            }}
            disabled={loading}
          >
            <option value="">Generic (no persona)</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon} {p.label}
              </option>
            ))}
          </select>
          <select
            className="persona-select"
            value={selectedContext}
            onChange={(e) => setSelectedContext(e.target.value)}
            disabled={loading || !activePersona}
          >
            <option value="">Select context…</option>
            {contexts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            className="analyze-btn"
            onClick={handleAnalyze}
            disabled={!selected || loading}
          >
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
        {error && <div className="analyze-error">{error}</div>}
      </section>

      <section className="history-panel">
        <div className="section-head">
          <h2>🕘 Previously analysed</h2>
          <span className="count">{analyses.length}</span>
        </div>
        {analyses.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🗂️</div>
            <div className="title">No analyses yet</div>
            <div className="hint">Past meeting analyses will appear here.</div>
          </div>
        ) : (
          <div className="history-list">
            {analyses.map((a) => (
              <button
                key={`${a.sessionId}:${a.persona ?? ''}:${a.personaContext ?? ''}`}
                className="history-card"
                onClick={() => handleOpenAnalysis(a)}
              >
                <div className="history-head">
                  <span className="history-title">
                    {formatTime(a.createdAt)} — {a.sessionId}
                  </span>
                  <span className={`history-status status-${a.status}`}>{a.status}</span>
                </div>
                <div className="history-meta">
                  <span>{personaLabel(personas, a.persona, a.personaContext)}</span>
                  {a.summary && <span className="history-summary">{a.summary}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {analysis && (
        <section className="meeting-dashboard">
          <div className={`meeting-status status-${analysis.status}`}>
            {analysis.status === 'running' && '⏳ Analysis in progress…'}
            {analysis.status === 'pending' && '⏳ Queued for analysis…'}
            {analysis.status === 'failed' && `❌ Analysis failed: ${analysis.error ?? 'Unknown error'}`}
            {analysis.status === 'completed' && '✅ Analysis complete'}
          </div>

          {analysis.persona && (
            <div className="meeting-persona">
              Analyzed from a{' '}
              <strong>{personaLabel(personas, analysis.persona, analysis.personaContext)}</strong> perspective
            </div>
          )}

          {analysis.status === 'completed' && (
            <>
              {analysis.summary && (
                <div className="meeting-summary">
                  <h3>📋 Summary</h3>
                  <p>{analysis.summary}</p>
                </div>
              )}

              <div className="metrics-grid">
                {analysis.metrics.map((m) => (
                  <div key={m.key} className="metric-card">
                    <div className="metric-head">
                      <span className="metric-label">{m.label}</span>
                      <span className={`metric-score ${scoreColor(m.score)}`}>{m.score}</span>
                    </div>
                    <div className="metric-bar">
                      <div
                        className={`metric-fill ${scoreColor(m.score)}`}
                        style={{ width: `${m.score}%` }}
                      />
                    </div>
                    <p className="metric-summary">{m.summary}</p>
                    {m.evidence.length > 0 && (
                      <ul className="metric-evidence">
                        {m.evidence.map((e, i) => (
                          <li key={i}>“{e}”</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              {analysis.recommendations.length > 0 && (
                <div className="meeting-recommendations">
                  <h3>💡 Recommendations</h3>
                  <ul>
                    {analysis.recommendations.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
