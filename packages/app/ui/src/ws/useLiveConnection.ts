import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppStatus, QuestionEvent, SttMessage } from '../types';

export interface LiveState {
  status: AppStatus;
  statusLabel: string;
  latencyMs: number | null;
  questions: QuestionEvent[];
  transcripts: {
    microphone: { committed: string; partial: string };
    system: { committed: string; partial: string };
  };
}

const INITIAL_TRANSCRIPTS = {
  microphone: { committed: '', partial: '' },
  system: { committed: '', partial: '' },
};

const INITIAL: LiveState = {
  status: 'starting',
  statusLabel: 'Connecting…',
  latencyMs: null,
  questions: [],
  transcripts: INITIAL_TRANSCRIPTS,
};

// Manages the live WebSocket and exposes live questions + transcripts.
export function useLiveConnection() {
  const [state, setState] = useState<LiveState>(INITIAL);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);

  const setStatus = useCallback((status: AppStatus, label: string) => {
    setState((s) => ({ ...s, status, statusLabel: label }));
  }, []);

  const connect = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    setStatus('starting', 'Connecting…');

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      setStatus('error', 'Connection failed');
      timerRef.current = window.setTimeout(connect, 2000);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => setStatus('ready', 'Connected');

    ws.onmessage = (event) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(event.data as string);
      } catch {
        return;
      }

      if (data.type === 'question') {
        const q = data.question as QuestionEvent;
        if (q && typeof q.question === 'string') {
          setState((s) => {
            const exists = s.questions.some(
              (existing) => existing.sessionId === q.sessionId && existing.id === q.id
            );
            return {
              ...s,
              questions: exists
                ? s.questions.map((existing) =>
                    existing.sessionId === q.sessionId && existing.id === q.id ? q : existing
                  )
                : [...s.questions, q],
            };
          });
        }
        return;
      }

      if (data.type === 'stt' && data.message) {
        if (typeof data.latencyMs === 'number') {
          setState((s) => ({ ...s, latencyMs: data.latencyMs as number }));
        }
        const stt = data.message as SttMessage;
        if (stt.type === 'partial' && typeof stt.text === 'string' && stt.source) {
          setState((s) => {
            const seg = s.transcripts[stt.source as 'microphone' | 'system'];
            if (!seg) return s;
            const delta = stt.text!.trim();
            const partial = delta ? (seg.partial ? `${seg.partial} ${delta}` : delta) : seg.partial;
            return {
              ...s,
              transcripts: {
                ...s.transcripts,
                [stt.source as 'microphone' | 'system']: { ...seg, partial },
              },
            };
          });
        } else if (stt.type === 'final' && typeof stt.text === 'string' && stt.source) {
          setState((s) => {
            const seg = s.transcripts[stt.source as 'microphone' | 'system'];
            if (!seg) return s;
            const sentence = stt.text!.trim();
            const committed = sentence
              ? seg.committed
                ? `${seg.committed} ${sentence}`
                : sentence
              : seg.committed;
            return {
              ...s,
              transcripts: {
                ...s.transcripts,
                [stt.source as 'microphone' | 'system']: { committed, partial: '' },
              },
            };
          });
        } else if (stt.type === 'error') {
          setStatus('error', 'Server error');
        }
        return;
      }

      if (data.type === 'status') {
        const st = data.state as AppStatus;
        if (st === 'starting' || st === 'loading-model') {
          setStatus(st, data.detail ? `Loading model (${data.detail})…` : 'Loading model…');
        } else if (st === 'ready' || st === 'capturing') {
          setStatus(st, 'Connected');
        } else if (st === 'error') {
          setStatus('error', (data.detail as string) || 'Error');
        }
      }
    };

    ws.onclose = () => {
      setStatus('starting', 'Reconnecting…');
      timerRef.current = window.setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      // onclose handles reconnection.
    };
  }, [setStatus]);

  useEffect(() => {
    connect();
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const clearAll = useCallback(() => {
    setState((s) => ({
      ...s,
      questions: [],
      transcripts: {
        microphone: { committed: '', partial: '' },
        system: { committed: '', partial: '' },
      },
    }));
  }, []);

  return { state, clearAll };
}
