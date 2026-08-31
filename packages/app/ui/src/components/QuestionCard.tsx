import type { QuestionEvent, SessionQuestion } from '../types';

interface Props {
  question: QuestionEvent | SessionQuestion;
}

export default function QuestionCard({ question }: Props) {
  const label = question.status === 'answered' ? 'Answer' : question.status === 'stale' ? 'Note' : '';

  return (
    <div className="question">
      <div className="q-text">{question.question}</div>
      {question.reason ? (
        <div className={`q-reason ${question.status}`}>
          <span className="q-reason-label">{label}</span>
          {question.reason}
        </div>
      ) : null}
      <div className="q-meta">
        <span className={`q-status ${question.status}`}>{question.status}</span>
        {question.source ? <span className="q-source">{question.source}</span> : null}
      </div>
    </div>
  );
}
