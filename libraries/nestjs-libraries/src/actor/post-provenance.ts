import { BadRequestException } from '@nestjs/common';

export const PROVENANCE_FIELDS = [
  'agentName',
  'workflowId',
  'runId',
  'externalRef',
  'source',
] as const;
export type ProvenanceField = (typeof PROVENANCE_FIELDS)[number];
export type PostProvenance = Partial<Record<ProvenanceField, string>>;

export const PROVENANCE_HEADERS: Record<ProvenanceField, string> = {
  agentName: 'x-postsider-agent',
  workflowId: 'x-postsider-workflow-id',
  runId: 'x-postsider-run-id',
  externalRef: 'x-postsider-external-ref',
  source: 'x-postsider-source',
};

export const PROVENANCE_MAX_LENGTH = 255;

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/** Strip control characters, trim; undefined when nothing is left. */
function clean(field: ProvenanceField, value: string): string | undefined {
  const out = value.replace(CONTROL_CHARS, '').trim();
  if (!out) return undefined;
  if (out.length > PROVENANCE_MAX_LENGTH) {
    throw new BadRequestException(
      `Provenance field ${field} must be at most ${PROVENANCE_MAX_LENGTH} characters`
    );
  }
  return out;
}

/**
 * Claimed provenance from the request body and X-Postsider-* headers. The body
 * wins per field. These values are claims, never identity.
 */
export function parseProvenance(
  bodyProvenance: unknown,
  headers: Record<string, unknown>
): PostProvenance {
  if (
    bodyProvenance !== null &&
    bodyProvenance !== undefined &&
    (typeof bodyProvenance !== 'object' || Array.isArray(bodyProvenance))
  ) {
    throw new BadRequestException('provenance must be an object');
  }
  const body = (bodyProvenance ?? {}) as Record<string, unknown>;
  const out: PostProvenance = {};
  for (const field of PROVENANCE_FIELDS) {
    const fromBody = body[field];
    if (fromBody !== undefined && fromBody !== null) {
      if (typeof fromBody !== 'string') {
        throw new BadRequestException(
          `Provenance field ${field} must be a string`
        );
      }
      const v = clean(field, fromBody);
      if (v !== undefined) {
        out[field] = v;
        continue;
      }
    }
    const fromHeader = headers?.[PROVENANCE_HEADERS[field]];
    if (typeof fromHeader === 'string') {
      const v = clean(field, fromHeader);
      if (v !== undefined) out[field] = v;
    }
  }
  return out;
}

/** Only the defined, known keys, ready to spread into row data. */
export function provenanceToColumns(
  p: PostProvenance | undefined
): PostProvenance {
  const out: PostProvenance = {};
  for (const field of PROVENANCE_FIELDS) {
    const v = p?.[field];
    if (typeof v === 'string') out[field] = v;
  }
  return out;
}

export function provenanceView(
  row: Record<string, unknown> | null | undefined
): Record<ProvenanceField, string | null> {
  const out = {} as Record<ProvenanceField, string | null>;
  for (const field of PROVENANCE_FIELDS) {
    const v = row?.[field];
    out[field] = typeof v === 'string' ? v : null;
  }
  return out;
}
