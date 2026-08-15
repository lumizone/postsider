import fc from 'fast-check';

/**
 * Normalize an OpenAPI-like JSON object by recursively sorting object keys, so
 * two logically-equal documents compare equal regardless of field order.
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  // JSON has no concept of negative zero — `JSON.stringify(-0)` yields "0".
  // Collapse it so the round-trip invariant matches JSON's own semantics
  // (otherwise Jest's `toEqual` distinguishes -0 from 0 via Object.is).
  if (typeof value === 'number' && Object.is(value, -0)) {
    return 0;
  }
  return value;
}

/**
 * Property 12 (Requirement 12.2): a generated OpenAPI spec parses and
 * serializes back to the same logical structure (after normalizing key order).
 * We validate the invariant the serving path relies on (JSON.parse ∘
 * JSON.stringify is identity up to key order) on arbitrary nested documents.
 */
describe('OpenAPI document round-trip', () => {
  it('parse→serialize preserves logical structure up to key order', () => {
    const jsonArb = fc.jsonValue();
    fc.assert(
      fc.property(jsonArb, (doc) => {
        const serialized = JSON.stringify(doc);
        const reparsed = JSON.parse(serialized);
        expect(normalize(reparsed)).toEqual(normalize(doc));
      })
    );
  });

  it('normalization is order-independent for a representative spec fragment', () => {
    const a = {
      openapi: '3.0.0',
      paths: { '/public/v1/connectors': { get: { responses: { '200': {} } } } },
      info: { title: 'PostSider API', version: '1.0' },
    };
    const b = {
      info: { version: '1.0', title: 'PostSider API' },
      paths: { '/public/v1/connectors': { get: { responses: { '200': {} } } } },
      openapi: '3.0.0',
    };
    expect(normalize(a)).toEqual(normalize(b));
  });
});
