import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreatePolicyRuleDto,
  UpdatePolicyRuleDto,
} from './policy-rule.dto';

const base = { name: 'No links', condition: 'CONTAINS_LINK', effect: 'BLOCK' };

const errorsFor = async (patch: Record<string, unknown>, cls: any = CreatePolicyRuleDto) => {
  const errors = await validate(plainToInstance(cls, { ...base, ...patch }) as object);
  return errors.map((e) => e.property);
};

describe('CreatePolicyRuleDto', () => {
  it('accepts a minimal valid rule', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it('rejects empty and 121 character names', async () => {
    expect(await errorsFor({ name: '' })).toContain('name');
    expect(await errorsFor({ name: 'a'.repeat(121) })).toContain('name');
    expect(await errorsFor({ name: 'a'.repeat(120) })).toEqual([]);
  });

  it('rejects priority outside 0..1000 and non integers, allows omission', async () => {
    expect(await errorsFor({ priority: -1 })).toContain('priority');
    expect(await errorsFor({ priority: 1001 })).toContain('priority');
    expect(await errorsFor({ priority: 1.5 })).toContain('priority');
    expect(await errorsFor({ priority: 0 })).toEqual([]);
    expect(await errorsFor({ priority: 1000 })).toEqual([]);
    const dto = plainToInstance(CreatePolicyRuleDto, base);
    expect(dto.priority).toBeUndefined();
  });

  it('rejects unknown actor types', async () => {
    expect(await errorsFor({ appliesToActorTypes: ['ADMIN'] })).toContain('appliesToActorTypes');
    expect(await errorsFor({ appliesToActorTypes: ['USER', 'API_KEY'] })).toEqual([]);
  });

  it('caps filter arrays at 100 entries and rejects duplicates', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    expect(await errorsFor({ appliesToIntegrationIds: many })).toContain('appliesToIntegrationIds');
    expect(await errorsFor({ appliesToApiKeyIds: many })).toContain('appliesToApiKeyIds');
    expect(await errorsFor({ appliesToProviders: many })).toContain('appliesToProviders');
    expect(await errorsFor({ appliesToIntegrationIds: many.slice(0, 100) })).toEqual([]);
    expect(await errorsFor({ appliesToIntegrationIds: ['a', 'a'] })).toContain('appliesToIntegrationIds');
    expect(await errorsFor({ appliesToActorTypes: ['USER', 'USER'] })).toContain('appliesToActorTypes');
  });

  it('rejects unknown conditions and effects', async () => {
    expect(await errorsFor({ condition: 'NOPE' })).toContain('condition');
    expect(await errorsFor({ effect: 'ALLOW' })).toContain('effect');
  });

  it('requires an object for conditionParams when present', async () => {
    expect(await errorsFor({ conditionParams: 'x' })).toContain('conditionParams');
    expect(await errorsFor({ conditionParams: [] })).toContain('conditionParams');
    expect(await errorsFor({ conditionParams: { words: ['a'] } })).toEqual([]);
  });
});

describe('UpdatePolicyRuleDto', () => {
  it('allows a partial body but still validates the fields given', async () => {
    expect(await errorsFor({}, UpdatePolicyRuleDto)).toEqual([]);
    const errors = await validate(plainToInstance(UpdatePolicyRuleDto, { priority: 5000 }) as object);
    expect(errors.map((e) => e.property)).toContain('priority');
    const ok = await validate(plainToInstance(UpdatePolicyRuleDto, { enabled: false }) as object);
    expect(ok).toEqual([]);
  });
});
