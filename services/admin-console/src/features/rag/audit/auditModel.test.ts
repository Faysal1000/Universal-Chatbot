import {
  auditTargetPath,
  describeActor,
  describeAuditAction,
  describeTargetType,
  summariseAuditDetails,
} from './auditModel';

describe('audit labels', () => {
  it('turns action and target identifiers into words', () => {
    expect(describeAuditAction('index_version.promoted')).toBe('Index version promoted');
    expect(describeTargetType('client_block')).toBe('Client block');
  });

  it('names the actor by username first, then by admin id', () => {
    const adminUserId = '5c1d2e3f-0000-4000-8000-000000000000';
    expect(describeActor({ actorUsername: 'admin', actorAdminUserId: null })).toBe('admin');
    expect(describeActor({ actorUsername: null, actorAdminUserId: adminUserId })).toBe('Admin 5c1d2e3f');
    expect(describeActor({ actorUsername: null, actorAdminUserId: null })).toBe('API key or deleted admin');
  });
});

describe('auditTargetPath', () => {
  it('links documents that still exist', () => {
    expect(auditTargetPath({ action: 'document.updated', targetType: 'document', targetId: 'd1' })).toBe(
      '/rag/documents/d1',
    );
    expect(auditTargetPath({ action: 'document.deleted', targetType: 'document', targetId: 'd1' })).toBeNull();
  });

  it('links list pages for other targets and nothing without a target', () => {
    expect(auditTargetPath({ action: 'index_version.promoted', targetType: 'index_version', targetId: '3' })).toBe(
      '/rag/index-versions',
    );
    expect(auditTargetPath({ action: 'admin.logged_in', targetType: 'admin_user', targetId: 'a' })).toBeNull();
    expect(auditTargetPath({ action: 'x', targetType: null, targetId: null })).toBeNull();
  });
});

describe('summariseAuditDetails', () => {
  it('lists details on one line and folds nested values', () => {
    expect(summariseAuditDetails({ isEnabled: false, changes: { title: 'x' } })).toBe('isEnabled: false, changes: {…}');
    expect(summariseAuditDetails({})).toBe('No details');
  });
});
