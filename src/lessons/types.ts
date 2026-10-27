import type { ExperimentState } from '@/state/schema';

export interface LessonStep {
  title: string;
  /** Explanation (trusted, author-written HTML with <p>, <em>, <code>, <strong>, <ul>). */
  body: string;
  /** Configures the real laboratories when the step is entered. */
  setup?: (s: ExperimentState) => void;
  /** Optional exploratory task; `check` observes the live state. */
  task?: {
    prompt: string;
    check: (s: ExperimentState) => boolean;
    success: string;
    /** Applies one valid solution ("Show me"). */
    solve: (s: ExperimentState) => void;
  };
  /** Short hint shown on request. */
  hint?: string;
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  level: 'Foundations' | 'Quantization' | 'Arithmetic' | 'Networks';
  minutes: number;
  steps: LessonStep[];
}
