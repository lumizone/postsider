import { PostActorType as PrismaPostActorType } from '@prisma/client';
import {
  POST_ACTOR_TYPES,
  SYSTEM_ACTOR,
  actorFromPublicCredential,
  actorFromUser,
  actorToColumns,
  actorViewFromColumns,
} from './post-actor';

describe('post-actor', () => {
  it('POST_ACTOR_TYPES matches the Prisma enum', () => {
    expect([...POST_ACTOR_TYPES].sort()).toEqual(
      Object.values(PrismaPostActorType).sort()
    );
  });

  describe('actorToColumns', () => {
    it('maps a USER', () => {
      expect(actorToColumns({ type: 'USER', userId: 'u1' }, 'createdBy')).toEqual({
        createdByType: 'USER',
        createdByUserId: 'u1',
        createdByApiKeyId: null,
        createdByOAuthClientId: null,
      });
    });
    it('maps an API_KEY with null id', () => {
      expect(
        actorToColumns({ type: 'API_KEY', apiKeyId: null }, 'lastModifiedBy')
      ).toEqual({
        lastModifiedByType: 'API_KEY',
        lastModifiedByUserId: null,
        lastModifiedByApiKeyId: null,
        lastModifiedByOAuthClientId: null,
      });
    });
    it('maps SYSTEM with only the type set', () => {
      expect(actorToColumns({ type: 'SYSTEM' }, 'requestedBy')).toEqual({
        requestedByType: 'SYSTEM',
        requestedByUserId: null,
        requestedByApiKeyId: null,
        requestedByOAuthClientId: null,
      });
    });
    it('maps OAUTH_CLIENT without userId', () => {
      const c = actorToColumns(
        { type: 'OAUTH_CLIENT', oauthClientId: 'c1' },
        'requestedBy'
      );
      expect(c.requestedByOAuthClientId).toBe('c1');
      expect(c.requestedByUserId).toBeNull();
    });
    it('maps OAUTH_CLIENT with userId, type stays OAUTH_CLIENT', () => {
      expect(
        actorToColumns(
          { type: 'OAUTH_CLIENT', oauthClientId: 'c1', userId: 'u7' },
          'createdBy'
        )
      ).toEqual({
        createdByType: 'OAUTH_CLIENT',
        createdByUserId: 'u7',
        createdByApiKeyId: null,
        createdByOAuthClientId: 'c1',
      });
    });
  });

  describe('actorFromPublicCredential', () => {
    it('maps api-key', () => {
      expect(actorFromPublicCredential({ type: 'api-key', id: 'k1' })).toEqual({
        type: 'API_KEY',
        apiKeyId: 'k1',
      });
    });
    it('maps legacy', () => {
      expect(actorFromPublicCredential({ type: 'legacy' })).toEqual({
        type: 'API_KEY',
        apiKeyId: null,
      });
    });
    it('maps oauth with user', () => {
      expect(
        actorFromPublicCredential({
          type: 'oauth',
          oauthClientId: 'c1',
          oauthUserId: 'u7',
        })
      ).toEqual({ type: 'OAUTH_CLIENT', oauthClientId: 'c1', userId: 'u7' });
    });
    it('maps oauth without user (no userId key)', () => {
      const a = actorFromPublicCredential({ type: 'oauth', oauthClientId: 'c1' });
      expect(a).toEqual({ type: 'OAUTH_CLIENT', oauthClientId: 'c1' });
      expect('userId' in a).toBe(false);
    });
    it('maps oauth without client id to null', () => {
      expect(actorFromPublicCredential({ type: 'oauth' })).toEqual({
        type: 'OAUTH_CLIENT',
        oauthClientId: null,
      });
    });
    it('falls back to SYSTEM', () => {
      expect(actorFromPublicCredential(undefined)).toEqual(SYSTEM_ACTOR);
      expect(actorFromPublicCredential(null)).toEqual(SYSTEM_ACTOR);
      expect(actorFromPublicCredential({ type: 'weird' } as any)).toEqual(
        SYSTEM_ACTOR
      );
    });
  });

  describe('actorFromUser', () => {
    it('maps a user id', () => {
      expect(actorFromUser({ id: 'u1' })).toEqual({ type: 'USER', userId: 'u1' });
    });
    it('falls back to SYSTEM', () => {
      expect(actorFromUser({})).toEqual(SYSTEM_ACTOR);
      expect(actorFromUser(null)).toEqual(SYSTEM_ACTOR);
      expect(actorFromUser(undefined)).toEqual(SYSTEM_ACTOR);
    });
  });

  describe('actorViewFromColumns', () => {
    it('builds an OAUTH_CLIENT view with both ids', () => {
      expect(
        actorViewFromColumns(
          {
            createdByType: 'OAUTH_CLIENT',
            createdByOAuthClientId: 'c1',
            createdByUserId: 'u7',
          },
          'createdBy'
        )
      ).toEqual({ type: 'OAUTH_CLIENT', oauthClientId: 'c1', userId: 'u7' });
    });
    it('omits null ids', () => {
      expect(
        actorViewFromColumns(
          { createdByType: 'API_KEY', createdByApiKeyId: 'k1', createdByUserId: null },
          'createdBy'
        )
      ).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
    });
    it('returns null for null type or missing row', () => {
      expect(actorViewFromColumns({ createdByType: null }, 'createdBy')).toBeNull();
      expect(actorViewFromColumns(undefined, 'createdBy')).toBeNull();
      expect(actorViewFromColumns(null, 'createdBy')).toBeNull();
    });
  });
});
