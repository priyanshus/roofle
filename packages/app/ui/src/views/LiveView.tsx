import { useState } from 'react';
import { MicIcon, QuestionIcon, SpeakerIcon, TranscriptIcon, TrashIcon } from '../components/Icons';
import QuestionCard from '../components/QuestionCard';
import type { LiveState } from '../ws/useLiveConnection';

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
          <span className="count">{live.questions.length}</span>
        </div>
        {live.questions.length === 0 ? (
          <div className="empty-state">
            <div className="icon">
              <QuestionIcon size={30} />
            </div>
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
