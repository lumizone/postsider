import { HttpException } from '@nestjs/common';
import type { PolicyEffectName, PolicyMatch } from './policy-types';

const MAX_NAMES_IN_MESSAGE = 5;
const MAX_NAME_CHARS = 60;

/** Rule names are admin text: strip control characters and dashes, bound the length. */
export function sanitizePolicyName(name: string): string {
  const clean = String(name ?? '')
    // C0 and C1 controls, zero width and bidi controls, line separators
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]+/g, ' ')
    // Unicode dashes and minus signs
    .replace(/[\u058a\u05be\u1806\u2010-\u2015\u2212\u2e3a\u2e3b\ufe58\ufe63\uff0d]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > MAX_NAME_CHARS ? `${clean.slice(0, MAX_NAME_CHARS - 3)}...` : clean;
}

/** Matches as exposed to API clients: same sanitizer as the message. */
export function sanitizeMatches(matched: PolicyMatch[]): PolicyMatch[] {
  return matched.map((m) => ({ ...m, name: sanitizePolicyName(m.name) }));
}

type BlockedOutcome = {
  matched: PolicyMatch[];
  channels: Array<{ integrationId: string; effect: 'ALLOW' | PolicyEffectName }>;
};

/** A write refused by a BLOCK rule. Plain HttpException so the global filter keeps the 422. */
export class PolicyBlockedException extends HttpException {
  constructor(outcome: BlockedOutcome) {
    const names = outcome.matched
      .filter((m) => m.effect === 'BLOCK')
      .slice(0, MAX_NAMES_IN_MESSAGE)
      .map((m) => sanitizePolicyName(m.name) || 'unnamed rule');
    super(
      {
        error: 'policy_blocked',
        msg: `This post was blocked by a policy: ${names.join(', ')}.`,
        policy: {
          effect: 'BLOCK',
          matched: sanitizeMatches(outcome.matched.filter((m) => m.effect === 'BLOCK')),
          channels: outcome.channels.filter((c) => c.effect === 'BLOCK').map((c) => c.integrationId),
        },
      },
      422
    );
  }
}

/** Write time fails closed when the content is too large to evaluate. */
export function policyInputTooLarge(): HttpException {
  return new HttpException(
    {
      error: 'policy_input_too_large',
      msg: 'This post is too large to check against the policies of this workspace. Shorten it and try again.',
    },
    400
  );
}
