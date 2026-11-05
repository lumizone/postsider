import { BadRequestException } from '@nestjs/common';
import {
  PROVENANCE_FIELDS,
  PROVENANCE_HEADERS,
  PROVENANCE_MAX_LENGTH,
  parseProvenance,
  provenanceToColumns,
  provenanceView,
} from './post-provenance';

describe('parseProvenance', () => {
  it('exposes the exact fields, headers and limit', () => {
    expect(PROVENANCE_FIELDS).toEqual([
      'agentName',
      'workflowId',
      'runId',
      'externalRef',
      'source',
    ]);
    expect(PROVENANCE_HEADERS).toEqual({
      agentName: 'x-postsider-agent',
      workflowId: 'x-postsider-workflow-id',
      runId: 'x-postsider-run-id',
      externalRef: 'x-postsider-external-ref',
      source: 'x-postsider-source',
    });
    expect(PROVENANCE_MAX_LENGTH).toBe(255);
  });

  it('trims and strips control characters', () => {
    expect(parseProvenance({ agentName: '  n8n  ' }, {})).toEqual({
      agentName: 'n8n',
    });
    expect(parseProvenance({ agentName: 'a\u0000b\nc\u009fd' }, {})).toEqual({
      agentName: 'abcd',
    });
  });

  it('treats whitespace-only and control-only values as absent', () => {
    expect(parseProvenance({ agentName: '   ', runId: '\u0000\n' }, {})).toEqual({});
  });

  it('accepts exactly 255 characters and rejects 256', () => {
    expect(
      parseProvenance({ agentName: 'a'.repeat(255) }, {}).agentName
    ).toHaveLength(255);
    expect(() => parseProvenance({ agentName: 'a'.repeat(256) }, {})).toThrow(
      BadRequestException
    );
    try {
      parseProvenance({ agentName: 'a'.repeat(256) }, {});
    } catch (e: any) {
      expect(e.message).toContain('agentName');
      expect(e.message).toContain('255');
    }
  });

  it('rejects non-string body fields naming the field', () => {
    expect(() => parseProvenance({ runId: 5 }, {})).toThrow(/runId/);
  });

  it('rejects a body provenance that is not an object', () => {
    expect(() => parseProvenance('x', {})).toThrow(BadRequestException);
    expect(() => parseProvenance([], {})).toThrow(BadRequestException);
    expect(() => parseProvenance(5, {})).toThrow(BadRequestException);
  });

  it('treats null and undefined body provenance as none', () => {
    expect(parseProvenance(null, {})).toEqual({});
    expect(parseProvenance(undefined, {})).toEqual({});
  });

  it('lets the body win over the header per field', () => {
    expect(
      parseProvenance(
        { agentName: 'body' },
        { 'x-postsider-agent': 'header', 'x-postsider-source': 'n8n' }
      )
    ).toEqual({ agentName: 'body', source: 'n8n' });
  });

  it('rejects an over-long header, ignores array and non-string headers', () => {
    expect(() =>
      parseProvenance(undefined, { 'x-postsider-run-id': 'r'.repeat(256) })
    ).toThrow(/runId/);
    expect(
      parseProvenance(undefined, {
        'x-postsider-run-id': ['a', 'b'],
        'x-postsider-source': 5,
      })
    ).toEqual({});
  });

  it('drops unknown keys', () => {
    const out = parseProvenance({ prompt: 'secret', agentName: 'a' }, {});
    expect(out).toEqual({ agentName: 'a' });
    expect(out).not.toHaveProperty('prompt');
  });
});

describe('provenanceToColumns', () => {
  it('keeps only defined known keys', () => {
    expect(
      provenanceToColumns({ agentName: 'a', runId: undefined, rogue: 'x' } as any)
    ).toEqual({ agentName: 'a' });
    expect(provenanceToColumns(undefined)).toEqual({});
  });
});

describe('provenanceView', () => {
  it('returns all five fields, null when missing', () => {
    expect(provenanceView({ agentName: 'a', other: 1 })).toEqual({
      agentName: 'a',
      workflowId: null,
      runId: null,
      externalRef: null,
      source: null,
    });
    expect(provenanceView(null)).toEqual({
      agentName: null,
      workflowId: null,
      runId: null,
      externalRef: null,
      source: null,
    });
  });
});
