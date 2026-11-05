import { NotificationService } from './notification.service';

const member = (id: string, role = 'ADMIN') => ({
  role,
  user: { id, email: `${id}@x.co`, sendSuccessEmails: true },
});

const make = (assigned: string[], members = [member('a'), member('b'), member('c')]) => {
  const assignments = {
    listForIntegration: jest.fn(async () => assigned.map((userId) => ({ userId }))),
  };
  const orgs = { getAllUsersOrgs: jest.fn(async () => ({ users: members })) };
  const email = { sendEmail: jest.fn(async () => undefined) };
  const svc = new NotificationService(
    {} as any,
    email as any,
    orgs as any,
    {} as any,
    assignments as any
  );
  return { svc, assignments, email, members };
};

describe('NotificationService.narrowToChannelAssignees', () => {
  it('keeps only the assigned members when at least one of them is in the pool', async () => {
    const { svc, members } = make(['b']);
    const out = await svc.narrowToChannelAssignees('o1', 'int1', members);
    expect(out.map((m: any) => m.user.id)).toEqual(['b']);
  });

  it('no assignments, or none of them in the pool, leaves the pool unchanged', async () => {
    const none = make([]);
    expect(await none.svc.narrowToChannelAssignees('o1', 'int1', none.members)).toHaveLength(3);
    const outsider = make(['someone-else']);
    expect(await outsider.svc.narrowToChannelAssignees('o1', 'int1', outsider.members)).toHaveLength(3);
  });

  it('without a channel it does not narrow and does not query', async () => {
    const { svc, assignments, members } = make(['b']);
    expect(await svc.narrowToChannelAssignees('o1', undefined, members)).toHaveLength(3);
    expect(assignments.listForIntegration).not.toHaveBeenCalled();
  });

  it('notifyApprovers still emails only the assigned approvers', async () => {
    const { svc, email } = make(['b']);
    await svc.notifyApprovers('o1', 's', 'm', 'int1');
    expect(email.sendEmail.mock.calls.map((c: any[]) => c[0])).toEqual(['b@x.co']);
  });
});
