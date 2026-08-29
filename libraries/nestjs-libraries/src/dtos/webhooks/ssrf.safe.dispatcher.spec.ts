import dns from 'node:dns';
import { ssrfSafeLookup } from './ssrf.safe.dispatcher';

describe('ssrfSafeLookup', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects a hexadecimal IPv4-mapped IPv6 literal', () => {
    const callback = jest.fn();

    ssrfSafeLookup('::ffff:7f00:1', {}, callback);

    expect(callback).toHaveBeenCalledWith(expect.any(Error), '', 0);
    expect(callback.mock.calls[0][0].message).toBe('Blocked IP');
  });

  it('rejects an IPv6 link-local literal at the end of fe80::/10', () => {
    const callback = jest.fn();

    ssrfSafeLookup('febf::1', {}, callback);

    expect(callback).toHaveBeenCalledWith(expect.any(Error), '', 0);
    expect(callback.mock.calls[0][0].message).toBe('Blocked IP');
  });

  it('rejects a mapped link-local address returned by DNS', () => {
    jest.spyOn(dns, 'lookup').mockImplementation(((
      _hostname,
      _options,
      callback
    ) => {
      callback(null, [{ address: '::ffff:a9fe:101', family: 6 }], 0);
    }) as any);
    const callback = jest.fn();

    ssrfSafeLookup('hooks.example.test', { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(expect.any(Error), '', 0);
    expect(callback.mock.calls[0][0].message).toBe('Blocked IP');
  });

  it('rejects an IPv6 link-local address returned by DNS', () => {
    jest.spyOn(dns, 'lookup').mockImplementation(((_hostname, _options, callback) => {
      callback(null, [{ address: 'fea0::1', family: 6 }], 0);
    }) as any);
    const callback = jest.fn();

    ssrfSafeLookup('hooks.example.test', { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(expect.any(Error), '', 0);
    expect(callback.mock.calls[0][0].message).toBe('Blocked IP');
  });
});
