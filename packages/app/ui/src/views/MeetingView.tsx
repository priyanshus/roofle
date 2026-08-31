import { useCallback, useEffect, useRef, useState } from 'react';
import {
  analyzeMeeting,
  fetchMeetingAnalyses,
  fetchMeetingAnalysis,
  fetchPersonas,
  fetchSessions,
} from '../api/client';
import { AlertIcon, CheckIcon, ClockIcon, LibraryIcon, SpinnerIcon } from '../components/Icons';
import ScoreGauge from '../components/ScoreGauge';
import type {
  MeetingAnalysis,
  MeetingAnalysisStatus,
  MeetingMetric,
  Persona,
  SessionSummary,
} from '../types';

const POLL_INTERVAL_MS = 2000;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const minutes = Math.round((Date.now() - d.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'good';
  if (score >= 50) return 'mid';
  return 'low';
}

function overallScore(metrics: MeetingMetric[]): number {
  if (metrics.length === 0) return 0;
  const sum = metrics.reduce((acc, m) => acc + m.score, 0);
  return Math.round(sum / metrics.length);
}

function personaLabel(
  personas: Persona[],
  personaId?: string,
  contextId?: string
): string {
  if (!personaId) return 'Generic';
  const p = personas.find((x) => x.id === personaId);
  if (!p) return personaId;
  if (!contextId) return p.label;
  const c = p.contexts.find((x) => x.id === contextId);
  return c ? `${p.label} — ${c.label}` : p.label;
}

const STATUS_LABEL: Record<MeetingAnalysisStatus, string> = {
  pending: 'Queued',
  running: 'Analyzing',
  completed: 'Completed',
  failed: 'Failed',
};

function statusText(a: MeetingAnalysis): string {
  if (a.status === 'failed') return a.error ?? 'Analysis failed';
  if (a.status === 'pending') return 'Queued for analysis';
  if (a.status === 'running') return 'Analyzing conversation…';
  return 'Analysis complete';
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
  const [dataLoading, setDataLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const activePersona = personas.find((p) => p.id === selectedPersona);
  const contexts = activePersona?.contexts ?? [];

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSessions(), fetchMeetingAnalyses(), fetchPersonas()])
      .then(([{ sessions: list }, { analyses: aList }, { personas: pList }]) => {
        if (cancelled) return;
        setSessions(list);
        setAnalyses(aList);
        setAnalyzedIds(new Set(aList.map((a) => a.sessionId)));
        setPersonas(pList);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load data');
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false);
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
      }, POLL_INTERVAL_MS);
    },
    [stopPolling]
  );

  useEffect(() => stopPolling, [stopPolling]);

  const handleAnalyze = async () => {
    if (!selected) return;
    setError(null);
    setAnalyzing(true);
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
      setAnalyzing(false);
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

  const handleClear = () => {
    stopPolling();
    setAnalysis(null);
  };

  // Brings the analyze panel into view and focuses the conversation select.
  const focusAnalyze = () => {
    document.getElementById('session-select')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('session-select')?.focus();
  };

  const isActive = (a: MeetingAnalysis) =>
    analysis?.sessionId === a.sessionId &&
    analysis?.persona === a.persona &&
    analysis?.personaContext === a.personaContext;

  const unanalyzed = sessions.filter((s) => !analyzedIds.has(s.sessionId));
  const options = selectedPersona ? sessions : unanalyzed;

  const statusIcon = (status: MeetingAnalysisStatus) => {
    if (status === 'running') return <SpinnerIcon size={16} />;
    if (status === 'pending') return <ClockIcon size={16} />;
    if (status === 'completed') return <CheckIcon size={16} />;
    return <AlertIcon size={16} />;
  };

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h2>Meeting CoPilot</h2>
          <p className="page-sub">Turn recorded conversations into scores, insights, and next steps.</p>
        </div>
      </div>

      <section className="analyze-panel">
        <div className="analyze-row">
          <div className="analyze-field">
            <label className="field-label" htmlFor="session-select">Conversation</label>
            <select
              id="session-select"
              className="session-select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={analyzing || dataLoading}
            >
              <option value="">
                {selectedPersona ? 'Select a conversation…' : 'Select an unanalyzed conversation…'}
              </option>
              {options
                .slice()
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                .map((s) => (
                  <option key={s.sessionId} value={s.sessionId}>
                    {formatTime(s.startedAt)}
                  </option>
                ))}
            </select>
          </div>

          <div className="analyze-field">
            <label className="field-label" htmlFor="persona-select">Perspective</label>
            <select
              id="persona-select"
              className="persona-select"
              value={selectedPersona}
              onChange={(e) => {
                setSelectedPersona(e.target.value);
                setSelectedContext('');
              }}
              disabled={analyzing || dataLoading}
            >
              <option value="">Generic</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="analyze-field">
            <label className="field-label" htmlFor="context-select">Context</label>
            <select
              id="context-select"
              className="persona-select"
              value={selectedContext}
              onChange={(e) => setSelectedContext(e.target.value)}
              disabled={analyzing || dataLoading || !activePersona}
            >
              <option value="">Any</option>
              {contexts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <button
            className="analyze-btn"
            onClick={handleAnalyze}
            disabled={!selected || analyzing}
          >
            {analyzing ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>

        {!selectedPersona && unanalyzed.length === 0 && !dataLoading && (
          <p className="analyze-hint">
            Every conversation has been analyzed. Pick a perspective to re-analyze any past conversation.
          </p>
        )}
        {error && (
          <div className="analyze-error">
            <span className="status-icon">
              <AlertIcon size={15} />
            </span>{' '}
            {error}
          </div>
        )}
      </section>

      <section className="history-panel">
        <div className="section-head">
          <h2>Recent analyses</h2>
          <span className="count">{analyses.length}</span>
        </div>
        {dataLoading ? (
          <div className="empty-state">
            <div className="icon">
              <SpinnerIcon size={30} />
            </div>
            <div className="title">Loading analyses…</div>
          </div>
        ) : analyses.length === 0 ? (
          <div className="empty-state">
            <div className="icon">
              <LibraryIcon size={30} />
            </div>
            <div className="title">No analyses yet</div>
            <div className="hint">Completed meeting analyses will appear here.</div>
            <button className="btn empty-action" onClick={focusAnalyze}>
              Analyze a conversation
            </button>
          </div>
        ) : (
          <div className="history-list">
            {analyses
              .slice()
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((a) => (
                <button
                  key={`${a.sessionId}:${a.persona ?? ''}:${a.personaContext ?? ''}`}
                  className={`history-card${isActive(a) ? ' active' : ''}`}
                  onClick={() => handleOpenAnalysis(a)}
                >
                  <div className="history-head">
                    <span className="history-title">{formatTime(a.createdAt)}</span>
                    <span className={`history-status status-${a.status}`}>
                      {STATUS_LABEL[a.status]}
                    </span>
                  </div>
                  <div className="history-meta">
                    <span>{personaLabel(personas, a.persona, a.personaContext)}</span>
                  </div>
                </button>
              ))}
          </div>
        )}
      </section>

      {analysis && (
        <section className="meeting-dashboard">
          <div className="meeting-head">
            <h2>{personaLabel(personas, analysis.persona, analysis.personaContext)}</h2>
            <div className="meeting-actions">
              <span className="meeting-time">{timeAgo(analysis.createdAt)}</span>
              <button className="btn clear-btn" onClick={handleClear}>
                Dismiss
              </button>
            </div>
          </div>

          <div className={`meeting-status status-${analysis.status}`}>
            <span className={`status-icon ${analysis.status === 'running' ? 'spin' : ''}`}>
              {statusIcon(analysis.status)}
            </span>
            {statusText(analysis)}
          </div>

          {analysis.status === 'completed' && (
            <>
              {analysis.metrics.length > 0 && (
                <div className="overall-card">
                  <ScoreGauge score={overallScore(analysis.metrics)} size={88} />
                  <div className="overall-body">
                    <span className="overall-label">Overall score</span>
                    <span className="overall-value">
                      {overallScore(analysis.metrics)}
                      <span className="overall-max">/100</span>
                    </span>
                    <p className="overall-note">
                      Average across {analysis.metrics.length} dimensions.
                    </p>
                  </div>
                </div>
              )}

              {analysis.metrics.length > 0 && (
                <div className="metrics-grid">
                  {analysis.metrics.map((m) => (
                    <div key={m.key} className="metric-card">
                      <div className="metric-head">
                        <span className="metric-label">{m.label}</span>
                        <span className={`metric-score ${scoreColor(m.score)}`}>{m.score}</span>
                      </div>
                      <div className="metric-gauge-row">
                        <ScoreGauge score={m.score} size={56} />
                        <p className="metric-summary">{m.summary}</p>
                      </div>
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
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
