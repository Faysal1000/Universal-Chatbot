import { describe, expect, it } from 'vitest';

import type { LanguageModelMessage } from '../../ports/language-model.port.js';
import { buildGroundedPrompt, type GroundedPromptInput } from './grounded-prompt.js';

function textOf(message: LanguageModelMessage | undefined): string {
  const content = message?.content ?? '';
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : `[image]`)).join('\n');
}

function partTypesOf(message: LanguageModelMessage | undefined): string[] {
  const content = message?.content ?? '';
  return typeof content === 'string' ? [] : content.map((part) => part.type);
}

const baseInput: GroundedPromptInput = {
  botName: 'HR Bot',
  adminInstruction: 'Be brief.',
  sources: [
    {
      sourceNumber: 1,
      documentTitle: 'Handbook',
      pageStart: 4,
      pageEnd: 5,
      contextualHeader: 'Handbook › Leave',
      text: 'Staff get 20 days of annual leave.',
    },
  ],
  conversationSummary: null,
  historyTurns: [],
  currentMessages: [{ text: 'How much leave do I get?', imageDataUrls: [] }],
};

describe('buildGroundedPrompt', () => {
  it('puts the fixed rules before the admin instruction in the system message', () => {
    const [systemMessage] = buildGroundedPrompt(baseInput);

    const systemText = textOf(systemMessage);
    expect(systemText.indexOf('Rules that always apply')).toBeLessThan(systemText.indexOf('Be brief.'));
  });

  it('numbers the sources in the latest user message', () => {
    const messages = buildGroundedPrompt(baseInput);

    const lastMessage = messages.at(-1);
    expect(lastMessage?.role).toBe('user');
    expect(textOf(lastMessage)).toContain('<source ref="[1]" document="Handbook" pages="4-5">');
  });

  it('keeps every batched visitor message as its own content part, images included', () => {
    const messages = buildGroundedPrompt({
      ...baseInput,
      currentMessages: [
        { text: 'First question', imageDataUrls: [] },
        { text: 'Second question', imageDataUrls: ['data:image/png;base64,AAAA'] },
      ],
    });

    expect(partTypesOf(messages.at(-1))).toEqual(['text', 'text', 'text', 'image', 'text']);
  });

  it('ends the latest message with the citation reminder', () => {
    const messages = buildGroundedPrompt(baseInput);

    expect(textOf(messages.at(-1))).toMatch(/cite each fact with its ref, such as \[1\]/);
  });

  it('without sources, sends only the visitor message and lets the model answer from the conversation', () => {
    const messages = buildGroundedPrompt({ ...baseInput, sources: [] });

    expect(textOf(messages[0])).toContain('Answer from the earlier conversation or general knowledge.');
    expect(textOf(messages.at(-1))).toBe('Visitor message:\nHow much leave do I get?');
  });

  it('adds the rolling summary to the system message and history as alternating turns', () => {
    const messages = buildGroundedPrompt({
      ...baseInput,
      conversationSummary: 'The visitor asked about pay.',
      historyTurns: [
        {
          turnId: 't1',
          messages: [
            { role: 'user', content: 'Hi', sequenceNumber: 1, estimatedTokenCount: 5 },
            { role: 'user', content: 'Pay day?', sequenceNumber: 2, estimatedTokenCount: 5 },
            { role: 'assistant', content: 'The 25th [1].', sequenceNumber: 3, estimatedTokenCount: 5 },
          ],
        },
      ],
    });

    expect(textOf(messages[0])).toContain('The visitor asked about pay.');
    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[1]?.content).toBe('Hi\n\nPay day?');
  });
});
