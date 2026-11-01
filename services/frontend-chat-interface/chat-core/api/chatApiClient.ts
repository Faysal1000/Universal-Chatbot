import { abortableSleep } from '@chat-core/shared/async/abortableSleep';

import { apiPaths, withQuery } from './apiPaths';
import { uploadAttachment, type UploadAttachmentOptions } from './attachmentUploader';
import {
  chatMessagePageSchema,
  citationPreviewSchema,
  conversationPageSchema,
  conversationSchema,
  publicChatConfigSchema,
  type Attachment,
  type ChatMessagePage,
  type CitationPreview,
  type Conversation,
  type ConversationPage,
  type FeedbackRating,
  type PublicChatConfig,
  type SubmitTurnRequest,
  type VisitorSession,
} from './chatApiContract';
import { HttpTransport, parseJsonResponse } from './httpTransport';
import { runTurnEventStream, type StreamTurnHandlers } from './turnEventStream';
import { VisitorSessionManager, type VisitorSessionStore } from './visitorSessionManager';

export type { StreamTurnHandlers } from './turnEventStream';
export type { UploadAttachmentOptions } from './attachmentUploader';
export type { VisitorSessionStore } from './visitorSessionManager';
export { reconnectDelayMs } from './turnEventStream';

export interface ChatApiClientOptions {
  baseUrl: string;
  sessionStore: VisitorSessionStore;
  /** Returns a Turnstile token (or null when the backend does not require one). */
  obtainTurnstileToken: () => Promise<string | null>;
  computeFingerprint: () => Promise<string>;
  /** A new visitor session replaced an expired one; its conversations are no longer visible. */
  onSessionReplaced?: () => void;
  fetchImplementation?: typeof fetch;
  createRequestId?: () => string;
  /** Sent with every request, e.g. the website widget's publishable key (`X-Widget-Key`). */
  defaultHeaders?: Readonly<Record<string, string>>;
  /** Resume attempts after a dropped stream before giving up. */
  maxStreamReconnectAttempts?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface MessagePageQuery {
  /** Cursor from the previous page's `nextCursor`; omit for the newest page. */
  before?: string | null;
  limit?: number;
}

const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const DEFAULT_CONVERSATION_PAGE_SIZE = 50;
const DEFAULT_MAX_STREAM_RECONNECT_ATTEMPTS = 5;

/**
 * Typed facade over the rag service's public chat API. Every response is validated against the contract; the
 * visitor session, transport, turn streaming and uploads live in their own modules.
 */
export class ChatApiClient {
  private readonly transport: HttpTransport;
  private readonly sessions: VisitorSessionManager;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(private readonly options: ChatApiClientOptions) {
    this.transport = new HttpTransport({
      baseUrl: options.baseUrl,
      ...(options.fetchImplementation ? { fetchImplementation: options.fetchImplementation } : {}),
      ...(options.createRequestId ? { createRequestId: options.createRequestId } : {}),
      ...(options.defaultHeaders ? { defaultHeaders: options.defaultHeaders } : {}),
    });
    this.sessions = new VisitorSessionManager({
      transport: this.transport,
      store: options.sessionStore,
      obtainTurnstileToken: options.obtainTurnstileToken,
      computeFingerprint: options.computeFingerprint,
      ...(options.onSessionReplaced ? { onSessionReplaced: options.onSessionReplaced } : {}),
    });
    this.sleep = options.sleep ?? abortableSleep;
  }

  // ── Configuration and session ──────────────────────────────────────────────────────────────────────────

  async getConfig(signal?: AbortSignal): Promise<PublicChatConfig> {
    const response = await this.transport.send(apiPaths.config(), { signal: signal ?? null });
    return parseJsonResponse(response, publicChatConfigSchema);
  }

  /** Returns a valid visitor session, creating one when missing or about to expire. */
  ensureSession(): Promise<VisitorSession> {
    return this.sessions.ensureSession();
  }

  // ── Conversations and history ──────────────────────────────────────────────────────────────────────────

  async listConversations(
    params: { query?: string; cursor?: string | null; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<ConversationPage> {
    const path = withQuery(apiPaths.conversations(), {
      q: params.query,
      cursor: params.cursor,
      limit: params.limit ?? DEFAULT_CONVERSATION_PAGE_SIZE,
    });
    const response = await this.sessions.authorizedSend(path, { signal: signal ?? null });
    return parseJsonResponse(response, conversationPageSchema);
  }

  async createConversation(title?: string): Promise<Conversation> {
    const response = await this.sessions.authorizedSend(
      apiPaths.conversations(),
      jsonBody('POST', title ? { title } : {}),
    );
    return parseJsonResponse(response, conversationSchema);
  }

  async renameConversation(conversationId: string, title: string): Promise<Conversation> {
    const response = await this.sessions.authorizedSend(
      apiPaths.conversation(conversationId),
      jsonBody('PATCH', { title }),
    );
    return parseJsonResponse(response, conversationSchema);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.sessions.authorizedSend(apiPaths.conversation(conversationId), { method: 'DELETE' });
  }

  /** One page of history in chronological order; follow `nextCursor` (as `before`) for older messages. */
  async listMessages(
    conversationId: string,
    query: MessagePageQuery = {},
    signal?: AbortSignal,
  ): Promise<ChatMessagePage> {
    const path = withQuery(apiPaths.messages(conversationId), {
      before: query.before,
      limit: query.limit ?? DEFAULT_MESSAGE_PAGE_SIZE,
    });
    const response = await this.sessions.authorizedSend(path, { signal: signal ?? null });
    return parseJsonResponse(response, chatMessagePageSchema);
  }

  // ── Turns ──────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Submits a batch of user messages and streams the single assistant reply. Resolves after the terminal event
   * (`message.completed`, `error` or `turn.superseded`) has been delivered to `handlers.onEvent`.
   */
  streamTurn(
    conversationId: string,
    request: SubmitTurnRequest,
    handlers: StreamTurnHandlers,
    signal: AbortSignal,
  ): Promise<void> {
    return this.runStream({ conversationId, turnId: request.turnId, submission: request }, handlers, signal);
  }

  /**
   * Re-attaches to a turn that may still be generating server-side (e.g. after a page reload) by replaying its
   * events from the start. Rejects with `not_found` when the turn is unknown or its buffer expired.
   */
  resumeTurnStream(
    conversationId: string,
    turnId: string,
    handlers: StreamTurnHandlers,
    signal: AbortSignal,
  ): Promise<void> {
    return this.runStream({ conversationId, turnId, submission: null }, handlers, signal);
  }

  async cancelTurn(conversationId: string, turnId: string): Promise<void> {
    await this.sessions.authorizedSend(apiPaths.cancelTurn(conversationId, turnId), { method: 'POST' });
  }

  // ── Attachments, citations, feedback ───────────────────────────────────────────────────────────────────

  uploadAttachment(file: File, options: UploadAttachmentOptions = {}): Promise<Attachment> {
    return uploadAttachment({ transport: this.transport, sessions: this.sessions }, file, options);
  }

  async getCitationPreview(citationId: string, signal?: AbortSignal): Promise<CitationPreview> {
    const response = await this.sessions.authorizedSend(apiPaths.citationPreview(citationId), {
      signal: signal ?? null,
    });
    return parseJsonResponse(response, citationPreviewSchema);
  }

  async sendFeedback(messageId: string, rating: FeedbackRating): Promise<void> {
    await this.sessions.authorizedSend(apiPaths.messageFeedback(messageId), jsonBody('POST', { rating }));
  }

  /** Resolves a server-relative asset URL (attachment previews, page images) against the API base URL. */
  resolveAssetUrl(url: string): string {
    return this.transport.url(url);
  }

  private runStream(
    target: Parameters<typeof runTurnEventStream>[1],
    handlers: StreamTurnHandlers,
    signal: AbortSignal,
  ): Promise<void> {
    return runTurnEventStream(
      {
        send: (path, init) => this.sessions.authorizedSend(path, init),
        sleep: this.sleep,
        maxReconnectAttempts:
          this.options.maxStreamReconnectAttempts ?? DEFAULT_MAX_STREAM_RECONNECT_ATTEMPTS,
      },
      target,
      handlers,
      signal,
    );
  }
}

function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
