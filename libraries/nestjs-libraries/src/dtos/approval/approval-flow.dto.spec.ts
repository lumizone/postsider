import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateApprovalFlowDto,
  UpdateApprovalFlowDto,
  pickApprovalFlowFields,
} from './approval-flow.dto';

const stage = (over: Record<string, unknown> = {}) => ({
  name: 'Legal',
  minRole: 'ADMIN',
  ...over,
});

const check = async (cls: any, body: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(cls, body));
  return errors.map((e) => e.property);
};

describe('CreateApprovalFlowDto', () => {
  it('accepts a minimal valid flow', async () => {
    expect(await check(CreateApprovalFlowDto, { name: 'Flow', stages: [stage()] })).toEqual([]);
  });

  it('rejects 0 stages and 6 stages, accepts 5', async () => {
    expect(await check(CreateApprovalFlowDto, { name: 'F', stages: [] })).toContain('stages');
    expect(
      await check(CreateApprovalFlowDto, { name: 'F', stages: Array.from({ length: 6 }, () => stage()) })
    ).toContain('stages');
    expect(
      await check(CreateApprovalFlowDto, { name: 'F', stages: Array.from({ length: 5 }, () => stage()) })
    ).toEqual([]);
  });

  it('rejects missing stages and a flow name over 120 chars', async () => {
    expect(await check(CreateApprovalFlowDto, { name: 'F' })).toContain('stages');
    expect(await check(CreateApprovalFlowDto, { name: 'x'.repeat(121), stages: [stage()] })).toContain('name');
    expect(await check(CreateApprovalFlowDto, { name: '   ', stages: [stage()] })).toContain('name');
  });

  it('rejects a stage name of 81 chars, an empty one, and minRole USER', async () => {
    expect(
      await check(CreateApprovalFlowDto, { name: 'F', stages: [stage({ name: 'x'.repeat(81) })] })
    ).toContain('stages');
    expect(await check(CreateApprovalFlowDto, { name: 'F', stages: [stage({ name: '' })] })).toContain('stages');
    expect(
      await check(CreateApprovalFlowDto, { name: 'F', stages: [stage({ minRole: 'USER' })] })
    ).toContain('stages');
    expect(
      await check(CreateApprovalFlowDto, { name: 'F', stages: [stage({ minRole: 'SUPERADMIN' })] })
    ).toEqual([]);
  });

  it('rejects 21 approvers and duplicate approvers, accepts 20', async () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);
    expect(
      await check(CreateApprovalFlowDto, { name: 'F', stages: [stage({ approverUserIds: ids(21) })] })
    ).toContain('stages');
    expect(
      await check(CreateApprovalFlowDto, { name: 'F', stages: [stage({ approverUserIds: ['a', 'a'] })] })
    ).toContain('stages');
    expect(
      await check(CreateApprovalFlowDto, { name: 'F', stages: [stage({ approverUserIds: ids(20) })] })
    ).toEqual([]);
  });

  it('rejects non-boolean flags', async () => {
    expect(
      await check(CreateApprovalFlowDto, { name: 'F', isDefault: 'yes', stages: [stage()] })
    ).toContain('isDefault');
    expect(
      await check(CreateApprovalFlowDto, { name: 'F', stages: [stage({ allowGuest: 'x' })] })
    ).toContain('stages');
  });
});

describe('UpdateApprovalFlowDto', () => {
  it('makes every field optional', async () => {
    expect(await check(UpdateApprovalFlowDto, {})).toEqual([]);
    expect(await check(UpdateApprovalFlowDto, { isDefault: true })).toEqual([]);
  });

  it('still validates a supplied stages array', async () => {
    expect(await check(UpdateApprovalFlowDto, { stages: [] })).toContain('stages');
    expect(await check(UpdateApprovalFlowDto, { stages: [stage({ minRole: 'USER' })] })).toContain('stages');
  });
});

describe('pickApprovalFlowFields', () => {
  it('keeps only known fields, also inside stages', () => {
    const picked = pickApprovalFlowFields({
      name: 'F',
      organizationId: 'evil',
      id: 'x',
      deletedAt: 'x',
      stages: [{ name: 'S', minRole: 'ADMIN', flowId: 'evil', id: 'evil', position: 9 }],
    } as any);
    expect(picked).toEqual({ name: 'F', stages: [{ name: 'S', minRole: 'ADMIN' }] });
  });

  it('rejects null values', () => {
    expect(() => pickApprovalFlowFields({ name: null } as any)).toThrow();
    expect(() => pickApprovalFlowFields({ stages: [null] } as any)).toThrow();
  });
});
