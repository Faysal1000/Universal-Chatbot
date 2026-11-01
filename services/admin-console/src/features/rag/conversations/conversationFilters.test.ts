import {
  hasActiveConversationFilters,
  readConversationFilters,
  toConversationSearchParameters,
  validateConversationFilters,
  visitorConversationsSearch,
} from './conversationFilters';

const VISITOR_SESSION_ID = '0b6c2f4e-1d2a-4c3b-9e8f-7a6b5c4d3e2f';

describe('conversation filters in the URL', () => {
  it('round-trips through search parameters', () => {
    const filters = { searchText: 'leave', visitorSessionId: VISITOR_SESSION_ID };
    expect(readConversationFilters(toConversationSearchParameters(filters))).toEqual(filters);
  });

  it('leaves empty filters out of the URL', () => {
    expect(toConversationSearchParameters({ searchText: '  ', visitorSessionId: '' }).toString()).toBe('');
  });

  it('links to one visitor’s conversations', () => {
    expect(visitorConversationsSearch(VISITOR_SESSION_ID)).toBe(`?visitor=${VISITOR_SESSION_ID}`);
  });
});

describe('validateConversationFilters', () => {
  it('rejects a partial visitor session id', () => {
    expect(
      validateConversationFilters({ searchText: '', visitorSessionId: '0b6c2f4e' }).visitorSessionId,
    ).toBeDefined();
  });

  it('accepts empty filters', () => {
    expect(validateConversationFilters({ searchText: '', visitorSessionId: '' })).toEqual({});
    expect(hasActiveConversationFilters({ searchText: '', visitorSessionId: '' })).toBe(false);
  });
});
