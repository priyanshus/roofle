import type {
  MeetingAnalysis,
  Paragraph,
  SessionDetail,
  SessionSummary,
  TranscriptionEvent,
} from '@roofle/shared';
import { Connection } from './connection.js';
import { MeetingAnalysisRepository } from './meetingAnalysisRepository.js';
import { ParagraphRepository } from './paragraphRepository.js';
import { QuestionRepository } from './questionRepository.js';
import { SessionRepository } from './sessionRepository.js';
import { StreamRepository } from './streamRepository.js';
import { SummaryRepository } from './summaryRepository.js';

// Facade over the per-entity repositories. Keeps callers stable while each
// repository owns a single entity's persistence.
export class SqliteClient {
  private readonly connection: Connection;
  private readonly streams: StreamRepository;
  private readonly paragraphs: ParagraphRepository;
  private readonly questions: QuestionRepository;
  private readonly sessions: SessionRepository;
  private readonly meetings: MeetingAnalysisRepository;
  private readonly summaries: SummaryRepository;

  constructor(dbPath: string) {
    this.connection = new Connection(dbPath);
    this.streams = new StreamRepository(this.connection.db);
    this.paragraphs = new ParagraphRepository(this.connection.db);
    this.questions = new QuestionRepository(this.connection.db);
    this.sessions = new SessionRepository(this.connection.db);
    this.meetings = new MeetingAnalysisRepository(this.connection.db);
    this.summaries = new SummaryRepository(this.connection.db);
  }

  insertStream(transcription: TranscriptionEvent): void {
    this.streams.insertStream(transcription);
  }

  upsertParagraph(paragraph: Paragraph): void {
    this.paragraphs.upsertParagraph(paragraph);
  }

  getParagraphText(sessionId: string, source: string): string | null {
    return this.paragraphs.getParagraphText(sessionId, source);
  }

  insertQuestions(sessionId: string, source: string, questions: string[]): number[] {
    return this.questions.insertQuestions(sessionId, source, questions);
  }

  getOpenQuestions(sessionId: string, source: string): { id: number; question: string }[] {
    return this.questions.getOpenQuestions(sessionId, source);
  }

  getQuestionsByIds(ids: number[]): { id: number; question: string; reason: string | null }[] {
    return this.questions.getQuestionsByIds(ids);
  }

  resolveQuestion(id: number, status: string, reason: string): void {
    this.questions.resolveQuestion(id, status, reason);
  }

  upsertSummary(sessionId: string, summary: string): void {
    this.summaries.upsertSummary(sessionId, summary);
  }

  getSummary(sessionId: string): string | null {
    return this.summaries.getSummary(sessionId);
  }

  getTitle(sessionId: string): string | null {
    return this.summaries.getTitle(sessionId);
  }

  setTitle(sessionId: string, title: string): void {
    this.summaries.setTitle(sessionId, title);
  }

  touchSession(sessionId: string): void {
    this.sessions.touchSession(sessionId);
  }

  finalizeSession(sessionId: string): void {
    this.sessions.finalizeSession(sessionId);
  }

  getSessions(): SessionSummary[] {
    return this.sessions.getSessions();
  }

  getSession(sessionId: string): SessionDetail | null {
    return this.sessions.getSession(sessionId);
  }

  ensureMeetingAnalysis(
    sessionId: string,
    persona?: string,
    personaContext?: string
  ): MeetingAnalysis {
    return this.meetings.ensureMeetingAnalysis(sessionId, persona, personaContext);
  }

  getMeetingAnalysis(
    sessionId: string,
    persona?: string,
    personaContext?: string
  ): MeetingAnalysis | null {
    return this.meetings.getMeetingAnalysis(sessionId, persona, personaContext);
  }

  getMeetingAnalyses(): MeetingAnalysis[] {
    return this.meetings.getMeetingAnalyses();
  }

  markMeetingAnalysisRunning(
    sessionId: string,
    persona?: string,
    personaContext?: string
  ): void {
    this.meetings.markMeetingAnalysisRunning(sessionId, persona, personaContext);
  }

  saveMeetingAnalysisResult(
    sessionId: string,
    result: Omit<MeetingAnalysis, 'sessionId' | 'status' | 'createdAt'>
  ): void {
    this.meetings.saveMeetingAnalysisResult(sessionId, result);
  }

  failMeetingAnalysis(
    sessionId: string,
    error: string,
    persona?: string,
    personaContext?: string
  ): void {
    this.meetings.failMeetingAnalysis(sessionId, error, persona, personaContext);
  }

  close(): void {
    this.connection.close();
  }
}
