jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SettingsController } from './settings.controller';
import {
  CreateApiKeyDto,
  UpdateApiKeyDto,
} from '@postsider/nestjs-libraries/dtos/settings/create-api-key.dto';

const org = { id: 'org-1' } as any;
const user = { id: 'user-1' } as any;

const build = (channels: Array<{ id: string }> = [{ id: 'c1' }, { id: 'c2' }]) => {
  const organizations = {
    createApiKey: jest.fn().mockImplementation(async (_o, name, scopes, perms) => ({
      id: 'k1',
      name,
      scopes,
      ...perms,
      key: 'ps_raw',
    })),
    updateNamedApiKey: jest.fn().mockImplementation(async (_o, id, input) => ({ id, ...input })),
    listApiKeys: jest.fn().mockResolvedValue([
      { id: 'k1', name: 'n', scopes: [], allowedActions: ['DRAFT'], allowedIntegrationIds: ['c1'] },
    ]),
  };
  const integrations = { getIntegrationsList: jest.fn().mockResolvedValue(channels) };
  const audit = { logSecurityEvent: jest.fn().mockResolvedValue(undefined) };
  const controller = new SettingsController(
    organizations as any,
    {} as any,
    integrations as any,
    {} as any,
    {} as any,
    audit as any
  );
  return { controller, organizations, integrations, audit };
};

const dtoErrors = async (cls: any, plain: object) =>
  (await validate(plainToInstance(cls, plain))).map((e) => e.property);

describe('api key permissions: DTO', () => {
  it('rejects an unknown action', async () => {
    expect(await dtoErrors(CreateApiKeyDto, { name: 'n', allowedActions: ['FOO'] })).toContain('allowedActions');
  });
  it('rejects more than 100 channel ids', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `c${i}`);
    expect(await dtoErrors(CreateApiKeyDto, { name: 'n', allowedIntegrationIds: ids })).toContain('allowedIntegrationIds');
  });
  it('accepts valid lists, also on update', async () => {
    expect(await dtoErrors(UpdateApiKeyDto, { allowedActions: ['DRAFT', 'SCHEDULE'], allowedIntegrationIds: ['a'] })).toEqual([]);
    expect(await dtoErrors(UpdateApiKeyDto, { allowedActions: [] })).toEqual([]);
  });
});

describe('api key permissions: SettingsController', () => {
  it('rejects duplicate actions with 400', async () => {
    const { controller, organizations } = build();
    await expect(
      controller.createApiKey(org, user, { name: 'n', allowedActions: ['DRAFT', 'DRAFT'] } as any)
    ).rejects.toMatchObject({ status: 400 });
    expect(organizations.createApiKey).not.toHaveBeenCalled();
  });

  it('rejects an unknown channel id with 400 naming it', async () => {
    const { controller, organizations } = build();
    const err: any = await controller
      .createApiKey(org, user, { name: 'n', allowedIntegrationIds: ['c1', 'zzz'] } as any)
      .catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(JSON.stringify(err.getResponse())).toContain('zzz');
    expect(organizations.createApiKey).not.toHaveBeenCalled();
  });

  it('scopes the channel lookup to the organization', async () => {
    const { controller, integrations } = build();
    await controller.createApiKey(org, user, { name: 'n', allowedIntegrationIds: ['c1'] } as any);
    expect(integrations.getIntegrationsList).toHaveBeenCalledWith('org-1');
  });

  it('passes valid lists to the service, returns them and audits them', async () => {
    const { controller, organizations, audit } = build();
    const res: any = await controller.createApiKey(org, user, {
      name: 'n',
      allowedActions: ['DRAFT'],
      allowedIntegrationIds: ['c1'],
    } as any);
    expect(organizations.createApiKey).toHaveBeenCalledWith(
      'org-1',
      'n',
      expect.any(Array),
      { allowedActions: ['DRAFT'], allowedIntegrationIds: ['c1'] }
    );
    expect(res.allowedActions).toEqual(['DRAFT']);
    expect(res.allowedIntegrationIds).toEqual(['c1']);
    expect(audit.logSecurityEvent).toHaveBeenCalledWith(
      'org-1',
      'api_key.create',
      'user-1',
      expect.objectContaining({ allowedActions: ['DRAFT'], allowedIntegrationIds: ['c1'] })
    );
  });

  it('listing includes the lists', async () => {
    const { controller } = build();
    const list: any[] = await controller.listApiKeys(org);
    expect(list[0].allowedActions).toEqual(['DRAFT']);
    expect(list[0].allowedIntegrationIds).toEqual(['c1']);
  });

  it('update with only allowedActions: [] clears and audits it', async () => {
    const { controller, organizations, audit } = build();
    await controller.updateApiKey(org, user, 'k1', { allowedActions: [] } as any);
    expect(organizations.updateNamedApiKey).toHaveBeenCalledWith(
      'org-1',
      'k1',
      expect.objectContaining({ allowedActions: [] })
    );
    expect(audit.logSecurityEvent).toHaveBeenCalledWith(
      'org-1',
      'api_key.update',
      'user-1',
      expect.objectContaining({ apiKeyId: 'k1', allowedActions: [] })
    );
  });

  it('update with an unknown channel is a 400', async () => {
    const { controller } = build();
    await expect(
      controller.updateApiKey(org, user, 'k1', { allowedIntegrationIds: ['nope'] } as any)
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each(['allowedActions', 'allowedIntegrationIds'])(
    'update with null %s is a 400, not a 500',
    async (field) => {
      const { controller, organizations } = build();
      await expect(
        controller.updateApiKey(org, user, 'k1', { [field]: null } as any)
      ).rejects.toMatchObject({ status: 400 });
      expect(organizations.updateNamedApiKey).not.toHaveBeenCalled();
    }
  );

  it('names the offending action', async () => {
    const { controller } = build();
    const err: any = await controller
      .createApiKey(org, user, { name: 'n', allowedActions: ['FOO'] } as any)
      .catch((e) => e);
    expect(JSON.stringify(err.getResponse())).toContain('FOO');
  });

  it('does not accept a disabled channel', async () => {
    const { controller } = build([{ id: 'c1', disabled: true } as any]);
    await expect(
      controller.createApiKey(org, user, { name: 'n', allowedIntegrationIds: ['c1'] } as any)
    ).rejects.toMatchObject({ status: 400 });
  });

  it('update passes the lists to the service', async () => {
    const { controller, organizations } = build();
    await controller.updateApiKey(org, user, 'k1', {
      allowedActions: ['SCHEDULE'],
      allowedIntegrationIds: ['c2'],
    } as any);
    expect(organizations.updateNamedApiKey).toHaveBeenCalledWith('org-1', 'k1', {
      name: undefined,
      scopes: undefined,
      allowedActions: ['SCHEDULE'],
      allowedIntegrationIds: ['c2'],
    });
  });

  it('update with nothing is a 400', async () => {
    const { controller } = build();
    await expect(controller.updateApiKey(org, user, 'k1', {} as any)).rejects.toMatchObject({ status: 400 });
  });
});
