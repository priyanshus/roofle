import { useState } from 'react';
import type { LiveState } from '../ws/useLiveConnection';
import QuestionCard from '../components/QuestionCard';

interface Props {
  live: LiveState;
  onClear: () => void;
}

export default function LiveView({ live, onClear }: Props) {
  const [showTranscript, setShowTranscript] = useState(false);

  const renderText = (committed: string, partial: string) => {
    const text = partial ? `${committed} ${partial}` : committed;
    return text || 'No speech yet…';
  };

  return (
    <div className="content">
      <div className="toolbar">
        <span className="group-label">Views</span>
        <button className="toggle active" disabled>
          <span className="switch" />
          Questions
        </button>
        <button
          className={`toggle ${showTranscript ? 'active' : ''}`}
          onClick={() => setShowTranscript((v) => !v)}
        >
          <span className="switch" />
          Transcription
        </button>
        <div className="spacer" />
        <button className="btn danger" onClick={onClear}>
          Clear
        </button>
      </div>

      <section className="questions-panel">
        <div className="section-head">
          <h2>❓ Questions</h2>
          <span className="count">{live.questions.length}</span>
        </div>
        {live.questions.length === 0 ? (
          <div className="empty-state">
            <div className="icon">💡</div>
            <div className="title">No questions yet</div>
            <div className="hint">Questions detected from the conversation will appear here.</div>
          </div>
        ) : (
          <div className="questions-list">
            {live.questions.map((q) => (
              <QuestionCard key={`${q.sessionId}:${q.id}`} question={q} />
            ))}
          </div>
        )}
      </section>

      {showTranscript ? (
        <section className="transcripts">
          <div className="transcript">
            <div className="transcript-label">
              <span className="live" />🔊 Speaker
            </div>
            <div className="transcript-text">
              {renderText(live.transcripts.system.committed, live.transcripts.system.partial)}
            </div>
          </div>
          <div className="transcript">
            <div className="transcript-label">
              <span className="live" />🎤 Microphone
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
