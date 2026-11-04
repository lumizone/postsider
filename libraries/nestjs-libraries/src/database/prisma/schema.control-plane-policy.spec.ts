import { Prisma, PostAction, PolicyCondition, PolicyEffect, PublishErrorCategory } from '@prisma/client';

const model = (n: string) => Prisma.dmmf.datamodel.models.find((m) => m.name === n)!;
const field = (m: string, f: string) => model(m).fields.find((x) => x.name === f)!;

describe('control plane policy schema', () => {
  it('PostAction has exactly three values', () => {
    expect(Object.values(PostAction).sort()).toEqual(['DRAFT', 'PUBLISH_NOW', 'SCHEDULE']);
  });
  it('PolicyCondition and PolicyEffect have the exact values', () => {
    expect(Object.values(PolicyCondition).sort()).toEqual(
      ['ALWAYS', 'CONTAINS_LINK', 'CONTAINS_WORDS', 'DAILY_CAP_EXCEEDED', 'HAS_VIDEO', 'OUTSIDE_WINDOW', 'PUBLISH_NOW']
    );
    expect(Object.values(PolicyEffect).sort()).toEqual(['BLOCK', 'REQUIRE_APPROVAL']);
  });
  it('PublishErrorCategory gains POLICY_BLOCKED and keeps the rest', () => {
    expect(Object.values(PublishErrorCategory)).toEqual(expect.arrayContaining(['POLICY_BLOCKED', 'UNKNOWN_OUTCOME', 'UNKNOWN']));
  });
  it('ApiKey has list columns that default to empty', () => {
    expect(field('ApiKey', 'allowedActions')).toMatchObject({ type: 'PostAction', isList: true, isRequired: true });
    expect(field('ApiKey', 'allowedIntegrationIds')).toMatchObject({ type: 'String', isList: true });
  });
  it('PolicyRule has the filter, condition and soft delete columns', () => {
    for (const f of ['appliesToApiKeyIds', 'appliesToIntegrationIds', 'appliesToProviders']) {
      expect(field('PolicyRule', f)).toMatchObject({ type: 'String', isList: true });
    }
    expect(field('PolicyRule', 'appliesToActorTypes')).toMatchObject({ type: 'PostActorType', isList: true });
    expect(field('PolicyRule', 'conditionParams').type).toBe('Json');
    expect(field('PolicyRule', 'deletedAt').isRequired).toBe(false);
    expect(field('PolicyRule', 'organizationId').isRequired).toBe(true);
  });
});
