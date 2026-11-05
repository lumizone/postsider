import { Prisma } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const model = (n: string) => Prisma.dmmf.datamodel.models.find((m) => m.name === n)!;
const field = (m: string, f: string) => model(m)?.fields.find((x) => x.name === f)!;

const schemaText = readFileSync(join(__dirname, 'schema.prisma'), 'utf8');
const sql = readFileSync(
  join(__dirname, 'migrations', '20261105100000_control_plane_approvals_distribution', 'migration.sql'),
  'utf8'
);

const modelBlock = (name: string) => {
  const m = schemaText.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  return m ? m[0] : '';
};

describe('control plane approvals schema', () => {
  it('ApprovalFlow has the flow columns', () => {
    expect(field('ApprovalFlow', 'name')).toMatchObject({ type: 'String', isRequired: true });
    expect(field('ApprovalFlow', 'isDefault')).toMatchObject({ type: 'Boolean', isRequired: true });
    expect(field('ApprovalFlow', 'preventSelfApproval').type).toBe('Boolean');
    expect(field('ApprovalFlow', 'requireDistinctApprovers').type).toBe('Boolean');
    expect(field('ApprovalFlow', 'organizationId').isRequired).toBe(true);
    expect(field('ApprovalFlow', 'deletedAt').isRequired).toBe(false);
    expect(field('ApprovalFlow', 'stages')).toMatchObject({ type: 'ApprovalFlowStage', isList: true });
    expect(field('ApprovalFlow', 'rules')).toMatchObject({ type: 'PolicyRule', isList: true });
    expect(field('Organization', 'approvalFlows')).toMatchObject({ type: 'ApprovalFlow', isList: true });
  });

  it('ApprovalFlowStage has the stage columns and a unique position per flow', () => {
    expect(field('ApprovalFlowStage', 'position')).toMatchObject({ type: 'Int', isRequired: true });
    expect(field('ApprovalFlowStage', 'minRole')).toMatchObject({ type: 'Role', isRequired: true });
    expect(field('ApprovalFlowStage', 'approverUserIds')).toMatchObject({ type: 'String', isList: true });
    expect(field('ApprovalFlowStage', 'allowAutomation').type).toBe('Boolean');
    expect(field('ApprovalFlowStage', 'allowGuest').type).toBe('Boolean');
    expect(modelBlock('ApprovalFlowStage')).toMatch(/@@unique\(\[flowId, position\]\)/);
  });

  it('PostApprovalStage is a snapshot with a unique position per approval', () => {
    for (const f of ['position', 'name', 'minRole', 'approverUserIds', 'allowAutomation', 'allowGuest', 'status']) {
      expect(field('PostApprovalStage', f)).toBeDefined();
    }
    expect(field('PostApprovalStage', 'status').type).toBe('ApprovalStatus');
    expect(field('PostApprovalStage', 'decidedByType').type).toBe('PostActorType');
    for (const f of ['decidedByUserId', 'decidedByApiKeyId', 'decidedByOAuthClientId', 'decidedVia', 'note', 'decidedAt']) {
      expect(field('PostApprovalStage', f).isRequired).toBe(false);
    }
    const block = modelBlock('PostApprovalStage');
    expect(block).toMatch(/@@unique\(\[approvalId, position\]\)/);
    expect(block).toMatch(/@@index\(\[approvalId\]\)/);
    expect(field('PostApproval', 'stages')).toMatchObject({ type: 'PostApprovalStage', isList: true });
  });

  it('ApprovalActionToken stores only a unique hash', () => {
    for (const f of ['organizationId', 'approvalId', 'stagePosition', 'userId', 'tokenHash', 'expiresAt', 'usedAt', 'createdAt']) {
      expect(field('ApprovalActionToken', f)).toBeDefined();
    }
    expect(field('ApprovalActionToken', 'tokenHash').isUnique).toBe(true);
    expect(field('ApprovalActionToken', 'usedAt').isRequired).toBe(false);
    const block = modelBlock('ApprovalActionToken');
    expect(block).toMatch(/@@index\(\[approvalId\]\)/);
    expect(block).toMatch(/@@index\(\[expiresAt\]\)/);
  });

  it('PolicyRule links to a flow with SetNull', () => {
    expect(field('PolicyRule', 'approvalFlowId')).toMatchObject({ type: 'String', isRequired: false });
    expect(modelBlock('PolicyRule')).toMatch(/onDelete: SetNull/);
  });

  it('PostApproval gains stage progress, attribution and the hashed guest token', () => {
    expect(field('PostApproval', 'flowId').isRequired).toBe(false);
    expect(field('PostApproval', 'currentStage')).toMatchObject({ type: 'Int', isRequired: true, hasDefaultValue: true });
    expect(field('PostApproval', 'stageCount')).toMatchObject({ type: 'Int', isRequired: true, hasDefaultValue: true });
    expect(field('PostApproval', 'decidedVia').isRequired).toBe(false);
    expect(field('PostApproval', 'decidedByApiKeyId').isRequired).toBe(false);
    expect(field('PostApproval', 'decidedByOAuthClientId').isRequired).toBe(false);
    expect(field('PostApproval', 'guestTokenHash')).toMatchObject({ type: 'String', isRequired: false, isUnique: true });
    expect(modelBlock('PostApproval')).toMatch(/decidedVia\s+String\?\s+@db\.VarChar\(20\)/);
  });

  describe('migration.sql', () => {
    const hash = sql.indexOf(`SET "guestTokenHash" = encode(sha256(convert_to("guestToken", 'UTF8')), 'hex')`);
    const nulling = sql.indexOf(`SET "guestToken" = NULL`);

    it('hashes the plaintext guest token before nulling it', () => {
      expect(hash).toBeGreaterThan(-1);
      expect(nulling).toBeGreaterThan(hash);
      expect(sql).toMatch(/WHERE "guestToken" IS NOT NULL/);
    });

    it('is additive: no drops and no deletes', () => {
      expect(sql).not.toMatch(/DROP\s+COLUMN/i);
      expect(sql).not.toMatch(/DROP\s+TABLE/i);
      expect(sql).not.toMatch(/DELETE\s+FROM/i);
    });
  });
});
