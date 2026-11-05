import { HttpException } from '@nestjs/common';
import { runWithActor } from '../actor/actor-context';
import {
  actionForCreateType,
  actionForStoredState,
  assertKeyAllowed,
} from './key-permission.guard';

const actor = { type: 'API_KEY', id: 'k1', apiKeyId: 'k1' } as any;

function thrown(fn: () => void): HttpException {
  try {
    fn();
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('did not throw');
}

describe('assertKeyAllowed', () => {
  it('throws 403 key_action_not_allowed for a forbidden action', () => {
    runWithActor(
      actor,
      () => {
        const e = thrown(() => assertKeyAllowed('SCHEDULE', ['a']));
        expect(e).toBeInstanceOf(HttpException);
        expect(e.getStatus()).toBe(403);
        expect(e.getResponse()).toMatchObject({
          error: 'key_action_not_allowed',
          action: 'SCHEDULE',
          msg: 'This API key may not schedule.',
        });
      },
      { keyPermissions: { allowedActions: ['DRAFT'], allowedIntegrationIds: [] } }
    );
  });

  it('uses the right copy per action', () => {
    runWithActor(
      actor,
      () => {
        const msg = (a: any) => (thrown(() => assertKeyAllowed(a, [])).getResponse() as any).msg;
        expect(msg('PUBLISH_NOW')).toBe('This API key may not publish now.');
        expect(msg('DRAFT')).toBe('This API key may not create drafts.');
      },
      { keyPermissions: { allowedActions: ['SCHEDULE'], allowedIntegrationIds: [] } }
    );
  });

  it('throws 403 key_channel_not_allowed naming the channel', () => {
    runWithActor(
      actor,
      () => {
        const e = thrown(() => assertKeyAllowed('DRAFT', ['a', 'b']));
        expect(e.getStatus()).toBe(403);
        expect(e.getResponse()).toMatchObject({
          error: 'key_channel_not_allowed',
          integrationId: 'b',
          msg: 'This API key may not post to this channel.',
        });
      },
      { keyPermissions: { allowedActions: [], allowedIntegrationIds: ['a'] } }
    );
  });

  it('allows a permitted combination', () => {
    runWithActor(
      actor,
      () => expect(() => assertKeyAllowed('DRAFT', ['a'])).not.toThrow(),
      { keyPermissions: { allowedActions: ['DRAFT'], allowedIntegrationIds: ['a'] } }
    );
  });

  it('does not throw outside any context', () => {
    expect(() => assertKeyAllowed('PUBLISH_NOW', ['x'])).not.toThrow();
  });
});

describe('mapping helpers', () => {
  it('maps create types', () => {
    expect(actionForCreateType('draft')).toBe('DRAFT');
    expect(actionForCreateType('schedule')).toBe('SCHEDULE');
    expect(actionForCreateType('now')).toBe('PUBLISH_NOW');
  });
  it('maps stored states', () => {
    expect(actionForStoredState('DRAFT')).toBe('DRAFT');
    expect(actionForStoredState('QUEUE')).toBe('SCHEDULE');
    expect(actionForStoredState('ERROR')).toBe('SCHEDULE');
  });
});
