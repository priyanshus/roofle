interface Props {
  score: number;
  size?: number;
}

// Map a 0-100 score to a semantic tone (mirrors scoreColor in MeetingView).
function tone(score: number): string {
  if (score >= 80) return 'good';
  if (score >= 50) return 'mid';
  return 'low';
}

const TONE_COLOR: Record<string, string> = {
  good: 'var(--green)',
  mid: 'var(--amber)',
  low: 'var(--red)',
};

export default function ScoreGauge({ score, size = 64 }: Props) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference * (1 - clamped / 100);
  const color = TONE_COLOR[tone(clamped)];

  return (
    <div
      className="gauge"
      role="img"
      aria-label={`Score ${clamped} out of 100`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--card-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="gauge-value" style={{ color }}>
        {clamped}
      </span>
    </div>
  );
}
