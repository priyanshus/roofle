import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchSession } from '../api/client';
import { AlertIcon, BackIcon, QuestionIcon, SpinnerIcon, TranscriptIcon } from '../components/Icons';
import QuestionCard from '../components/QuestionCard';
import type { SessionDetail } from '../types';

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function SessionView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setSession(null);
    setError(null);
    fetchSession(sessionId)
      .then(({ session }) => {
        if (!cancelled) setSession(session);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load session');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

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

  if (session === null) {
    return (
      <div className="content">
        <div className="empty-state">
          <div className="icon">
            <SpinnerIcon size={30} />
          </div>
          <div className="title">Loading conversation…</div>
        </div>
      </div>
    );
  }

  const visibleQuestions = onlyOpen
    ? session.questions.filter((q) => q.status === 'open')
    : session.questions;

  return (
    <div className="content">
      <div className="back-link">
        <Link to="/library">
          <BackIcon size={15} /> Back to conversations
        </Link>
      </div>

      <div className="section-head">
        <h2>{formatTime(session.startedAt)}</h2>
        <span className="count">{session.questions.length} questions</span>
      </div>

      <section className="transcript">
        <div className="transcript-label">
          <TranscriptIcon size={14} /> Transcription
        </div>
        <div className="transcript-text transcript-scroll">
          {session.transcription || 'No transcription for this session.'}
        </div>
      </section>

      <section className="questions-panel">
        <div className="section-head">
          <h2>Questions</h2>
          <button
            className={`filter-toggle ${onlyOpen ? 'active' : ''}`}
            onClick={() => setOnlyOpen((v) => !v)}
            title="Show only open questions"
          >
            Open only
          </button>
          <span className="count">{visibleQuestions.length}</span>
        </div>
        {visibleQuestions.length === 0 ? (
          <div className="empty-state">
            <div className="icon">
              <QuestionIcon size={30} />
            </div>
            <div className="title">No questions</div>
            <div className="hint">
              {onlyOpen && session.questions.length > 0
                ? 'All questions are answered or stale. Turn off “Open only” to see them.'
                : 'No questions were detected in this conversation.'}
            </div>
          </div>
        ) : (
          <div className="questions-list">
            {visibleQuestions.map((q) => (
              <QuestionCard key={q.id} question={q} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
