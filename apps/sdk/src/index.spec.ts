import fetch from 'node-fetch';
import Postsider, { PostsiderApiError } from './index';

jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
  FormData: class FormData {},
}));

const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

function response(status: number, body: unknown, statusText = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as any;
}

describe('Postsider SDK', () => {
  beforeEach(() => mockedFetch.mockReset());

  it('supports a configurable API base path', async () => {
    mockedFetch.mockResolvedValue(response(200, []));
    const client = new Postsider('key', 'https://self.host/', { apiBasePath: '/api/' });

    await client.integrations();

    expect(mockedFetch.mock.calls[0][0]).toBe('https://self.host/api/public/v1/integrations');
  });

  it('keeps the cloud URL unchanged by default', async () => {
    mockedFetch.mockResolvedValue(response(200, []));

    await new Postsider('key').integrations();

    expect(mockedFetch.mock.calls[0][0]).toBe(
      'https://api.postsider.com/public/v1/integrations'
    );
  });

  it('throws a structured error for non-2xx responses', async () => {
    mockedFetch.mockResolvedValue(response(422, { message: 'Invalid post' }));
    const client = new Postsider('key');

    await expect(client.post({} as any)).rejects.toMatchObject({
      name: 'PostsiderApiError',
      status: 422,
      method: 'POST',
      path: '/public/v1/posts',
      details: { message: 'Invalid post' },
    });
  });

  it('sends an idempotency key when posting', async () => {
    mockedFetch.mockResolvedValue(response(200, { id: 'post-1' }));
    const client = new Postsider('key');

    await client.post({} as any, 'retry-safe-key');

    expect(mockedFetch.mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ 'Idempotency-Key': 'retry-safe-key' }),
    });
  });

  it('checks delete responses and returns the parsed response', async () => {
    mockedFetch.mockResolvedValue(response(204, ''));
    const client = new Postsider('key');

    await expect(client.deletePost('post-1')).resolves.toBeNull();
    expect(mockedFetch.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it('uses the same structured error for failed deletes', async () => {
    mockedFetch.mockResolvedValue(response(404, { msg: 'Post not found' }));
    const client = new Postsider('key');

    await expect(client.deletePost('missing')).rejects.toBeInstanceOf(PostsiderApiError);
  });
});
