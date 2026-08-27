import type { QuestionEvent, SessionQuestion } from '../types';

interface Props {
  question: QuestionEvent | SessionQuestion;
}

export default function QuestionCard({ question }: Props) {
  return (
    <div className="question">
      <div className="q-text">{question.question}</div>
      <div className="q-meta">
        <span className={`q-status ${question.status}`}>{question.status}</span>
        {question.source ? <span className="q-source">{question.source}</span> : null}
      </div>
    </div>
  );
}
