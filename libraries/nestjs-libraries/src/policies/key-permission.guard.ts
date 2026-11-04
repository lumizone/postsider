import { HttpException } from '@nestjs/common';
import { currentKeyPermissions } from '../actor/actor-context';
import { checkKeyPermission } from './key-permissions';
import type { PostActionName } from './policy-types';

const ACTION_COPY: Record<PostActionName, string> = {
  DRAFT: 'create drafts',
  SCHEDULE: 'schedule',
  PUBLISH_NOW: 'publish now',
};

/**
 * Enforce the limits of the API key behind this request. Call it only at the
 * handler level of a public API route: the key limits live in the request
 * context, which is not visible in nested or background contexts. Outside a
 * request context, or for a key without limits, it does nothing. Throws a plain
 * HttpException with 403 (never HttpForbiddenException, which the global
 * filter turns into a 401 logout).
 */
export function assertKeyAllowed(
  action: PostActionName,
  integrationIds: readonly string[]
): void {
  const check = checkKeyPermission(
    currentKeyPermissions(),
    action,
    integrationIds
  );
  if (check.allowed) return;
  if (check.code === 'key_action_not_allowed') {
    throw new HttpException(
      {
        error: check.code,
        msg: `This API key may not ${ACTION_COPY[check.action]}.`,
        action: check.action,
        allowedActions: check.allowedActions,
      },
      403
    );
  }
  throw new HttpException(
    {
      error: check.code,
      msg: 'This API key may not post to this channel.',
      integrationId: check.integrationId,
      allowedIntegrationIds: check.allowedIntegrationIds,
    },
    403
  );
}

export function actionForCreateType(
  type: 'draft' | 'schedule' | 'now'
): PostActionName {
  if (type === 'draft') return 'DRAFT';
  if (type === 'now') return 'PUBLISH_NOW';
  return 'SCHEDULE';
}

/** A stored post in DRAFT is a draft action, any other state arms publishing. */
export function actionForStoredState(state: string): PostActionName {
  return state === 'DRAFT' ? 'DRAFT' : 'SCHEDULE';
}
