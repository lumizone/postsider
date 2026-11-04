import type { PostActionName } from './policy-types';

export type KeyPermissions = {
  allowedActions: PostActionName[];
  allowedIntegrationIds: string[];
};

export type KeyCheck =
  | { allowed: true }
  | {
      allowed: false;
      code: 'key_action_not_allowed';
      action: PostActionName;
      allowedActions: PostActionName[];
    }
  | {
      allowed: false;
      code: 'key_channel_not_allowed';
      integrationId: string;
      allowedIntegrationIds: string[];
    };

/**
 * Pure check of an API key's limits. An empty list means unrestricted. The
 * action is checked before the channels; the first offending channel is
 * reported.
 */
export function checkKeyPermission(
  perms: KeyPermissions | null | undefined,
  action: PostActionName,
  integrationIds: readonly string[]
): KeyCheck {
  if (!perms) return { allowed: true };
  const actions = perms.allowedActions ?? [];
  if (actions.length > 0 && !actions.includes(action)) {
    return {
      allowed: false,
      code: 'key_action_not_allowed',
      action,
      allowedActions: [...actions],
    };
  }
  const channels = perms.allowedIntegrationIds ?? [];
  if (channels.length > 0) {
    // A missing or empty channel id never passes a channel limit.
    const at = integrationIds.findIndex(
      (id) => typeof id !== 'string' || id === '' || !channels.includes(id)
    );
    if (at !== -1) {
      const offending = integrationIds[at];
      return {
        allowed: false,
        code: 'key_channel_not_allowed',
        integrationId: typeof offending === 'string' ? offending : '',
        allowedIntegrationIds: [...channels],
      };
    }
  }
  return { allowed: true };
}
