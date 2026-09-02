import { BillingController } from './billing.controller';

describe('BillingController cancellation', () => {
  it('cancels through Polar before sending best-effort feedback email', async () => {
    const setToCancel = jest.fn().mockResolvedValue({ id: 'cancel-1' });
    const sendEmail = jest
      .fn()
      .mockRejectedValue(new Error('email unavailable'));
    const controller = new BillingController(
      {} as any,
      { setToCancel } as any,
      { sendEmail } as any
    );

    await expect(
      controller.cancel(
        {
          id: 'org-1',
          name: 'Organization',
          users: [{ role: 'SUPERADMIN' }],
        } as any,
        { email: 'owner@example.com' } as any,
        { feedback: 'No longer needed' }
      )
    ).resolves.toEqual({ id: 'cancel-1' });

    expect(setToCancel).toHaveBeenCalledWith('org-1');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(setToCancel.mock.invocationCallOrder[0]).toBeLessThan(
      sendEmail.mock.invocationCallOrder[0]
    );
  });
});
