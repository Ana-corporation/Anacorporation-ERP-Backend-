import { applyAuditActors, collectActorIds } from './record-audit.util';

describe('record-audit.util', () => {
  it('maps createdBy to createdByUserId + createdByName', () => {
    const names = new Map([['12', 'Mohana Priya']]);
    const result = applyAuditActors(
      {
        vendorId: '1',
        createdBy: 12n,
        updatedBy: '12',
        createdAt: '2026-09-11T10:00:00.000Z',
      },
      names,
    );

    expect(result.createdByUserId).toBe('12');
    expect(result.createdByName).toBe('Mohana Priya');
    expect(result.updatedByUserId).toBe('12');
    expect(result.updatedByName).toBe('Mohana Priya');
    expect(result.deletedByUserId).toBeNull();
    expect(result.approvedByName).toBeNull();
  });

  it('collects numeric actor ids only', () => {
    expect(
      collectActorIds([
        { createdBy: 12, updatedBy: '12', deletedBy: null },
        { createdBy: 'abc' },
      ]),
    ).toEqual(['12']);
  });
});
