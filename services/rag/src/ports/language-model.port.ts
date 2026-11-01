export type LanguageModelContentPart =
  | { readonly type: 'text'; readonly text: string }
  /** `imageDataUrl` is a `data:image/...;base64,` URL; the gateway refuses remote URLs. */
  | { readonly type: 'image'; readonly imageDataUrl: string };

export interface LanguageModelMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string | readonly LanguageModelContentPart[];
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface LanguageModelRequest {
  /** Gateway task name, e.g. `answer_generation`; the gateway picks the model. */
  readonly task: string;
  readonly messages: readonly LanguageModelMessage[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  /** Turns on reasoning for models that need it requested (Anthropic, OpenAI). */
  readonly reasoningEffort?: ReasoningEffort;
  readonly requestId?: string;
}

export type LanguageModelFinishReason = 'stop' | 'length' | 'content_filter' | 'other';

export interface LanguageModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}

export interface LanguageModelCompletion {
  readonly content: string;
  readonly reasoning: string | null;
  readonly finishReason: LanguageModelFinishReason;
  readonly usage: LanguageModelUsage;
  /** Model that actually answered, as reported by the gateway. */
  readonly servedByModel: string | null;
}

export type LanguageModelStreamEvent =
  | { readonly type: 'reasoning_delta'; readonly text: string }
  | { readonly type: 'content_delta'; readonly text: string }
  | {
      readonly type: 'completed';
      readonly finishReason: LanguageModelFinishReason;
      readonly usage: LanguageModelUsage;
      readonly servedByModel: string | null;
    };

/** Assumed when no model behind a task declares its context window. */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 12_288;

/** Token limits of the models that would serve a task; null when no model declares one. */
export interface TaskTokenLimits {
  readonly contextWindowTokens: number | null;
  readonly maxOutputTokens: number | null;
}

export interface LanguageModelPort {
  complete(request: LanguageModelRequest, abortSignal?: AbortSignal): Promise<LanguageModelCompletion>;
  /** Streams one completion. Ends with exactly one `completed` event, or throws. */
  stream(request: LanguageModelRequest, abortSignal: AbortSignal): AsyncIterable<LanguageModelStreamEvent>;
  getTaskTokenLimits(task: string): Promise<TaskTokenLimits>;
}

export const LANGUAGE_MODEL_PORT = Symbol('LANGUAGE_MODEL_PORT');
