jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PublicPoliciesController } from './public.policies.controller';

const textOf = (operation: any) =>
  [operation.summary, operation.description].filter(Boolean).join('\n');

/** Every string reachable from a value, so dash checks cannot miss a field. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') {
    Object.values(value as object).forEach((v) => strings(v, out));
  }
  return out;
}

describe('public policy OpenAPI', () => {
  let app: any;
  let document: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicIntegrationsController, PublicPoliciesController],
    })
      .useMocker(() => ({}))
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });

  afterAll(async () => {
    await app.close();
  });

  it('describes the dry run and the five policy operations with their scopes', () => {
    const evaluate = document.paths['/public/v1/policies/evaluate'].post;
    expect(evaluate).toBeDefined();
    expect(textOf(evaluate)).toContain('posts:read');
    expect(textOf(evaluate)).toContain('literal path');
    expect(textOf(evaluate)).toContain('key_action_not_allowed');

    const list = document.paths['/public/v1/policies'].get;
    const create = document.paths['/public/v1/policies'].post;
    const get = document.paths['/public/v1/policies/{id}'].get;
    const update = document.paths['/public/v1/policies/{id}'].put;
    const remove = document.paths['/public/v1/policies/{id}'].delete;
    for (const op of [list, get]) expect(textOf(op)).toContain('policies:read');
    for (const op of [create, update, remove]) {
      expect(textOf(op)).toContain('policies:write');
    }
    expect(textOf(create)).toContain('policy.changed');
    expect(textOf(create)).toContain('audit event');
  });

  it('documents the policy error codes on the write routes', () => {
    const operations: Record<string, any> = {
      'POST /posts': document.paths['/public/v1/posts'].post,
      'PUT /posts/{id}': document.paths['/public/v1/posts/{id}'].put,
      'PUT /posts/{id}/status': document.paths['/public/v1/posts/{id}/status'].put,
      'retry-failed':
        document.paths['/public/v1/posts/group/{group}/retry-failed'].post,
    };
    for (const [name, op] of Object.entries(operations)) {
      const text = textOf(op);
      for (const code of [
        'key_action_not_allowed',
        'key_channel_not_allowed',
        'policy_blocked',
      ]) {
        expect({ name, has: text.includes(code) }).toEqual({ name, has: true });
      }
      expect({ name, has: text.includes('policy') }).toEqual({ name, has: true });
    }
    expect(textOf(operations['POST /posts'])).toContain('approvalRequested');
    expect(textOf(operations['PUT /posts/{id}/status'])).toContain('200');
    expect(textOf(operations['PUT /posts/{id}/status'])).toContain('APPROVAL');
    expect(operations['POST /posts'].responses['403']).toBeDefined();
    expect(operations['POST /posts'].responses['422']).toBeDefined();
    expect(operations['PUT /posts/{id}'].responses['403']).toBeDefined();
    expect(operations['PUT /posts/{id}'].responses['422']).toBeDefined();
    expect(operations['PUT /posts/{id}/status'].responses['403']).toBeDefined();
    expect(operations['PUT /posts/{id}/status'].responses['422']).toBeDefined();
    expect(operations['retry-failed'].responses['403']).toBeDefined();
    expect(operations['retry-failed'].responses['422']).toBeDefined();
  });

  it('has the rule and dry run response schemas', () => {
    const schemas = document.components.schemas;
    expect(schemas.PublicPolicyRuleDto).toBeDefined();
    expect(schemas.PublicPolicyEvaluationDto).toBeDefined();
    expect(Object.keys(schemas.PublicPolicyEvaluationDto.properties).sort()).toEqual(
      ['channels', 'effect', 'key', 'matched']
    );
    expect(schemas.PublicPolicyEvaluationDto.properties.effect.enum).toEqual([
      'ALLOW',
      'REQUIRE_APPROVAL',
      'BLOCK',
    ]);
    const okSchema =
      document.paths['/public/v1/policies/evaluate'].post.responses['200']
        .content['application/json'].schema;
    expect(okSchema.$ref).toContain('PublicPolicyEvaluationDto');
  });

  it('uses no en or em dashes in the generated document', () => {
    const offenders = strings(document).filter((s) => /[–—]/.test(s));
    expect(offenders).toEqual([]);
  });
});
