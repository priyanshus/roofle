import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface Props {
  label: string;
  icon: ReactNode;
  color: 'speaker' | 'microphone';
  committed: string;
  partial: string;
  isActive: boolean;
}

const COLOR_TOKENS = {
  speaker: {
    bg: 'var(--speaker-soft, #e8f0fe)',
    border: 'var(--speaker, #4285f4)',
    text: 'var(--speaker-deep, #1a5fcb)',
    dot: 'var(--speaker, #4285f4)',
    meter: 'var(--speaker, #4285f4)',
  },
  microphone: {
    bg: 'var(--mic-soft, #fce8e6)',
    border: 'var(--mic, #ea4335)',
    text: 'var(--mic-deep, #b31412)',
    dot: 'var(--mic, #ea4335)',
    meter: 'var(--mic, #ea4335)',
  },
};

function useAudioMeter(isActive: boolean) {
  const barsRef = useRef<HTMLDivElement[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      barsRef.current.forEach((bar) => {
        if (bar) bar.style.transform = 'scaleY(0.15)';
      });
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    let last = 0;
    const animate = (t: number) => {
      if (t - last > 80) {
        barsRef.current.forEach((bar) => {
          if (!bar) return;
          const h = 0.15 + Math.random() * 0.85;
          bar.style.transform = `scaleY(${h})`;
        });
        last = t;
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive]);

  return barsRef;
}

export default function TranscriptChannel({ label, icon, color, committed, partial, isActive }: Props) {
  const tokens = COLOR_TOKENS[color];
  const textRef = useRef<HTMLDivElement>(null);
  const barsRef = useAudioMeter(isActive);

  const text = partial ? `${committed} ${partial}` : committed;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const isEmpty = !committed && !partial;

  useEffect(() => {
    if (textRef.current && isActive) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [committed, partial, isActive]);

  return (
    <div
      className="t-channel"
      style={{ borderLeftColor: tokens.border }}
      aria-label={`${label} transcription`}
    >
      {/* Header */}
      <div className="t-header">
        <div className="t-header-left">
          <div
            className="t-icon-circle"
            style={{ background: tokens.bg, color: tokens.text }}
            aria-hidden="true"
          >
            {icon}
          </div>
          <div className="t-header-info">
            <span className="t-name">{label}</span>
            {isActive && (
              <span className="t-live-badge" aria-label="Live audio detected">
                <span className="t-live-dot" style={{ background: tokens.dot }} />
                LIVE
              </span>
            )}
          </div>
        </div>

        <div className="t-header-right">
          {/* Audio meter */}
          <div className="t-meter" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                ref={(el) => {
                  if (el) barsRef.current[i] = el;
                }}
                className="t-meter-bar"
                style={{ background: tokens.meter, transform: 'scaleY(0.15)' }}
              />
            ))}
          </div>
          <span className="t-word-count" aria-label={`${wordCount} words`}>
            {wordCount} word{wordCount !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Body */}
      <div ref={textRef} className="t-body">
        {isEmpty ? (
          <div className="t-empty">
            <span className="t-empty-icon" aria-hidden="true">
              {icon}
            </span>
            <span className="t-empty-title">Waiting for audio…</span>
            <span className="t-empty-hint">
              Speech detected on this channel will appear here.
            </span>
          </div>
        ) : (
          <div className="t-text" aria-live="polite" aria-atomic="false">
            {committed && <span className="t-committed">{committed}</span>}
            {partial && (
              <>
                {committed && <span className="t-space"> </span>}
                <span className="t-partial">{partial}</span>
                <span className="t-cursor" aria-hidden="true" />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
