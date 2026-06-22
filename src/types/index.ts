export type Category =
  | '工作经验核实'
  | '月嫂技能'
  | '儿童常见问题护理'
  | '先进育儿意识';

export interface Question {
  id: string;
  category: Category;
  text: string;
  answerGuide: string;
  greenFlags: string[];
  redFlags: string[];
  suggestedFollowUps: string[];
}

export interface CandidateProfile {
  name: string;
  yearsOfExperience: number;
  babiesHandled: number;
  longestAssignment: number; // months
}

export interface AIEvaluation {
  score: 1 | 2 | 3;
  highlights: string[];
  concerns: string[];
  followUp: string | null;
}

export interface AnswerRecord {
  questionId: string;
  transcript: string;
  evaluation: AIEvaluation | null;
  followUpTranscripts: string[];
  skipped: boolean;
}

export interface InterviewSession {
  id: string;
  candidate: CandidateProfile;
  startedAt: string;
  finishedAt?: string;
  answers: AnswerRecord[];
  report?: InterviewReport;
}

export interface InterviewReport {
  authenticityScore: 'high' | 'medium' | 'low';
  authenticityNote: string;
  categoryScores: Record<Category, number>;
  strengths: string[];
  concerns: string[];
  recommendation: '强烈推荐' | '推荐' | '谨慎考虑' | '不推荐';
  recommendationReason: string;
  dimensionNotes: Record<Category, string>;
  summary: string;
}

export type InterviewPhase =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'result'
  | 'follow_up';
