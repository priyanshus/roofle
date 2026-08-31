import type { CaptureState } from '../types';
import { PauseIcon, PlayIcon, PlusIcon, StopIcon } from './Icons';

interface Props {
  state: CaptureState;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onNewSession: () => void;
}

const STATE_LABEL: Record<CaptureState, string> = {
  running: 'Capturing',
  paused: 'Paused',
  stopped: 'Stopped',
};

export default function CaptureBar({ state, onStart, onStop, onPause, onResume, onNewSession }: Props) {
  const running = state === 'running';
  const paused = state === 'paused';

  return (
    <div className="capture-bar">
      <span className="group-label">Capture</span>

      {running ? (
        <>
          <button className="capture-btn" onClick={onPause} title="Pause capture">
            <PauseIcon size={16} /> Pause
          </button>
          <button className="capture-btn danger" onClick={onStop} title="Stop capture">
            <StopIcon size={16} /> Stop
          </button>
        </>
      ) : paused ? (
        <>
          <button className="capture-btn primary" onClick={onResume} title="Resume capture">
            <PlayIcon size={16} /> Resume
          </button>
          <button className="capture-btn danger" onClick={onStop} title="Stop capture">
            <StopIcon size={16} /> Stop
          </button>
        </>
      ) : (
        <button className="capture-btn primary" onClick={onStart} title="Start capture">
          <PlayIcon size={16} /> Start
        </button>
      )}

      <button className="capture-btn" onClick={onNewSession} title="Start a new session">
        <PlusIcon size={16} /> New Session
      </button>

      {/* Live region: state changes are announced without moving focus. */}
      <span className={`capture-state ${state}`} role="status" aria-live="polite" aria-atomic="true">
        <span className="capture-dot" aria-hidden="true" />
        {STATE_LABEL[state]}
      </span>
    </div>
  );
}
