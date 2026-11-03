import { jest, describe, it, expect } from '@jest/globals';
import {
  isChannelAdminRequest,
  scopeGuardedClient,
  MissingScopeError,
} from '../http/scope-guard.js';
import type { PostsiderClient } from '../client.js';

describe('isChannelAdminRequest', () => {
  it('flags channel mutations and the connect link', () => {
    expect(isChannelAdminRequest('POST', '/integrations/c1/disable')).toBe(true);
    expect(isChannelAdminRequest('PUT', '/integrations/c1/queue-plan')).toBe(true);
    expect(isChannelAdminRequest('PUT', '/integrations/c1/customer')).toBe(true);
    expect(isChannelAdminRequest('DELETE', '/integrations/c1')).toBe(true);
    expect(isChannelAdminRequest('GET', '/social/x')).toBe(true);
  });

  it('matches the way the API does: case-insensitively', () => {
    expect(isChannelAdminRequest('POST', '/Integrations/c1/disable')).toBe(true);
    expect(isChannelAdminRequest('get', '/SOCIAL/x')).toBe(true);
  });

  it('leaves reads, posts and library writes under their own scopes', () => {
    expect(isChannelAdminRequest('GET', '/integrations')).toBe(false);
    expect(isChannelAdminRequest('GET', '/integrations/c1/queue-plan')).toBe(false);
    expect(isChannelAdminRequest('GET', '/integrations/c1/smart-slots')).toBe(false);
    expect(isChannelAdminRequest('POST', '/posts')).toBe(false);
    expect(isChannelAdminRequest('POST', '/library/hashtag-groups')).toBe(false);
    expect(isChannelAdminRequest('DELETE', '/media/m1')).toBe(false);
  });
});

describe('scopeGuardedClient with channels:write', () => {
  const inner = () =>
    ({
      get: jest.fn(async () => 'g'),
      post: jest.fn(async () => 'p'),
      put: jest.fn(async () => 'u'),
      del: jest.fn(async () => 'd'),
    }) as unknown as PostsiderClient;

  it('lets posts:write schedule posts but not reconfigure channels', async () => {
    const guarded = scopeGuardedClient(inner(), new Set(['posts:read', 'posts:write']));

    await expect(guarded.post('/posts', {})).resolves.toBe('p');
    // The guard refuses synchronously, before any request is built.
    expect(() => guarded.post('/integrations/c1/disable')).toThrow(MissingScopeError);
    expect(() => guarded.get('/social/x')).toThrow(/channels:write/);
    expect(() => guarded.del('/integrations/c1')).toThrow(/channels:write/);
  });

  it('lets channels:write reconfigure channels', async () => {
    const guarded = scopeGuardedClient(
      inner(),
      new Set(['posts:read', 'posts:write', 'channels:write'])
    );
    await expect(guarded.post('/integrations/c1/enable')).resolves.toBe('p');
    await expect(guarded.get('/social/x')).resolves.toBe('g');
  });

  it('does not let channels:write alone read the calendar', async () => {
    const guarded = scopeGuardedClient(inner(), new Set(['channels:write']));
    expect(() => guarded.get('/posts')).toThrow(MissingScopeError);
  });
});
