import { useState } from 'react';
import CaptureBar from '../components/CaptureBar';
import { MicIcon, QuestionIcon, SpeakerIcon, TranscriptIcon, TrashIcon } from '../components/Icons';
import QuestionCard from '../components/QuestionCard';
import type { LiveState } from '../ws/useLiveConnection';

interface Props {
  live: LiveState;
  onClear: () => void;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onNewSession: () => void;
}

export default function LiveView({ live, onClear, onStart, onStop, onPause, onResume, onNewSession }: Props) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(true);

  const visibleQuestions = onlyOpen
    ? live.questions.filter((q) => q.status === 'open')
    : live.questions;

  const renderText = (committed: string, partial: string) => {
    const text = partial ? `${committed} ${partial}` : committed;
    return text || 'No speech yet…';
  };

  return (
    <div className="content">
      <CaptureBar
        state={live.captureState}
        onStart={onStart}
        onStop={onStop}
        onPause={onPause}
        onResume={onResume}
        onNewSession={onNewSession}
      />

      <div className="toolbar">
        <span className="group-label">Views</span>
        <button className="toggle active" disabled>
          <span className="switch" />
          <QuestionIcon size={15} /> Questions
        </button>
        <button
          className={`toggle ${showTranscript ? 'active' : ''}`}
          onClick={() => setShowTranscript((v) => !v)}
        >
          <span className="switch" />
          <TranscriptIcon size={15} /> Transcription
        </button>
        <div className="spacer" />
        <button className="btn danger" onClick={onClear}>
          <TrashIcon size={15} /> Clear
        </button>
      </div>

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
              {onlyOpen && live.questions.length > 0
                ? 'All questions are answered or stale. Turn off “Open only” to see them.'
                : live.captureState === 'stopped'
                  ? 'Start a capture to begin detecting questions from the conversation.'
                  : 'Questions detected from the conversation will appear here.'}
            </div>
            {live.captureState === 'stopped' && (
              <button className="btn empty-action" onClick={onStart}>
                Start capture
              </button>
            )}
          </div>
        ) : (
          <div className="questions-list">
            {visibleQuestions.map((q) => (
              <QuestionCard key={`${q.sessionId}:${q.id}`} question={q} />
            ))}
          </div>
        )}
      </section>

      {showTranscript ? (
        <section className="transcripts">
          <div className="transcript">
            <div className="transcript-label">
              <span className="live" />
              <SpeakerIcon size={14} /> Speaker
            </div>
            <div className="transcript-text">
              {renderText(live.transcripts.system.committed, live.transcripts.system.partial)}
            </div>
          </div>
          <div className="transcript">
            <div className="transcript-label">
              <span className="live" />
              <MicIcon size={14} /> Microphone
            </div>
            <div className="transcript-text">
              {renderText(live.transcripts.microphone.committed, live.transcripts.microphone.partial)}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
