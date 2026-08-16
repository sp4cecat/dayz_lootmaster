import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as cfg from '../../server/cftools-config.js';
import { request, cachedGet, getVehicles, getEvents, _resetState, CfToolsError } from '../../server/cftools-client.js';

// Minimal fetch Response stand-in.
const jsonResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k] ?? null },
  json: async () => body,
});

let fetchMock;

beforeEach(() => {
  cfg._resetState();
  _resetState();
  cfg.setAppCredentials({ applicationId: 'app-1', secret: 's3cret' });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const authCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/auth/register'));
const dataCalls = (path) => fetchMock.mock.calls.filter(([url]) => String(url).includes(path));

describe('auth', () => {
  it('registers once and reuses the token across requests', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/v1/auth/register')) return jsonResponse(200, { token: 'tok-1' });
      return jsonResponse(200, { ok: true });
    });
    await request('GET', '/v1/server/abc/info');
    await request('GET', '/v1/server/abc/statistics');
    expect(authCalls()).toHaveLength(1);
  });

  it('serializes concurrent auth behind one in-flight registration', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/v1/auth/register')) return jsonResponse(200, { token: 'tok-1' });
      return jsonResponse(200, { ok: true });
    });
    await Promise.all([
      request('GET', '/v1/server/abc/info'),
      request('GET', '/v1/server/abc/statistics'),
      request('GET', '/v1/server/abc/GSM/list'),
    ]);
    expect(authCalls()).toHaveLength(1);
  });

  it('throws not_configured without credentials', async () => {
    cfg.clearAppCredentials();
    await expect(request('GET', '/v1/x')).rejects.toMatchObject({ reason: 'not_configured' });
  });

  it('maps rejected credentials to auth_failed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, {}));
    await expect(request('GET', '/v1/x')).rejects.toMatchObject({ reason: 'auth_failed' });
  });
});

describe('401 retry', () => {
  it('re-registers once and retries once on a 401', async () => {
    let tokens = 0;
    fetchMock.mockImplementation(async (url, opts) => {
      if (String(url).includes('/v1/auth/register')) return jsonResponse(200, { token: `tok-${++tokens}` });
      // First data call (old token) 401s; retry with the new token succeeds.
      if (opts.headers.Authorization === 'Bearer tok-1') return jsonResponse(401, {});
      return jsonResponse(200, { fine: true });
    });
    const result = await request('GET', '/v1/server/abc/info');
    expect(result).toEqual({ fine: true });
    expect(authCalls()).toHaveLength(2);
    expect(dataCalls('/v1/server/abc/info')).toHaveLength(2);
  });

  it('gives up after one retry (no retry loop)', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/v1/auth/register')) return jsonResponse(200, { token: 'tok' });
      return jsonResponse(401, {});
    });
    await expect(request('GET', '/v1/x')).rejects.toMatchObject({ reason: 'auth_failed' });
    expect(dataCalls('/v1/x')).toHaveLength(2); // original + exactly one retry
  });
});

describe('error mapping', () => {
  it('maps 403 to no_grant and network failure to unreachable', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/v1/auth/register')) return jsonResponse(200, { token: 'tok' });
      return jsonResponse(403, {});
    });
    await expect(request('GET', '/v1/x')).rejects.toMatchObject({ reason: 'no_grant' });

    _resetState();
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/v1/auth/register')) return jsonResponse(200, { token: 'tok' });
      throw new Error('ECONNREFUSED');
    });
    await expect(request('GET', '/v1/x')).rejects.toMatchObject({ reason: 'unreachable' });
  });
});

describe('cachedGet', () => {
  const okFetch = (payload) => async (url) => {
    if (String(url).includes('/v1/auth/register')) return jsonResponse(200, { token: 'tok' });
    return jsonResponse(200, payload);
  };

  it('serves fresh cache within the TTL without refetching', async () => {
    fetchMock.mockImplementation(okFetch({ n: 1 }));
    const first = await cachedGet('api1', 'info', '/v1/server/api1/info', 60_000);
    const second = await cachedGet('api1', 'info', '/v1/server/api1/info', 60_000);
    expect(first.stale).toBe(false);
    expect(second.data).toEqual({ n: 1 });
    expect(dataCalls('/v1/server/api1/info')).toHaveLength(1);
  });

  it('dedupes concurrent misses into one upstream fetch', async () => {
    fetchMock.mockImplementation(okFetch({ n: 2 }));
    const results = await Promise.all(
      Array.from({ length: 5 }, () => cachedGet('api1', 'sessions', '/v1/server/api1/GSM/list', 5_000)),
    );
    expect(results.every(r => r.data.n === 2)).toBe(true);
    expect(dataCalls('/GSM/list')).toHaveLength(1);
  });

  it('serves the stale entry marked stale:true during a 429 cooldown', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(okFetch({ n: 3 }));
    await cachedGet('api1', 'info', '/v1/server/api1/info', 1_000);

    // TTL expires; upstream now rate-limits.
    vi.advanceTimersByTime(2_000);
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/v1/auth/register')) return jsonResponse(200, { token: 'tok' });
      return jsonResponse(429, {}, { 'Retry-After': '30' });
    });
    const rateLimited = await cachedGet('api1', 'info', '/v1/server/api1/info', 1_000);
    expect(rateLimited).toMatchObject({ stale: true, data: { n: 3 } });

    // Still inside the cooldown: no upstream call at all, stale served again.
    const before = dataCalls('/v1/server/api1/info').length;
    const duringCooldown = await cachedGet('api1', 'info', '/v1/server/api1/info', 1_000);
    expect(duringCooldown.stale).toBe(true);
    expect(dataCalls('/v1/server/api1/info')).toHaveLength(before);
  });

  it('rethrows when rate-limited with no cached entry', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/v1/auth/register')) return jsonResponse(200, { token: 'tok' });
      return jsonResponse(429, {}, { 'Retry-After': '5' });
    });
    await expect(cachedGet('api1', 'fresh', '/v1/server/api1/info', 1_000))
      .rejects.toBeInstanceOf(CfToolsError);
  });

  it('hits the real GameLabs entities routes (regression: entity-vehicles 404s)', async () => {
    // The Data API's routes are /GameLabs/entities/{vehicles,events} — the
    // hyphenated entity-vehicles/entity-events variants do not exist and 404,
    // which surfaced as every GameLabs layer reading "unavailable" on staging.
    fetchMock.mockImplementation(okFetch({ entities: [] }));
    await getVehicles('api1');
    await getEvents('api1');
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain('https://data.cftools.cloud/v1/server/api1/GameLabs/entities/vehicles');
    expect(urls).toContain('https://data.cftools.cloud/v1/server/api1/GameLabs/entities/events');
    expect(urls.some(u => u.includes('entity-vehicles') || u.includes('entity-events'))).toBe(false);
  });

  it('serves stale on non-429 upstream errors too', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(okFetch({ n: 4 }));
    await cachedGet('api1', 'ev', '/v1/server/api1/GameLabs/entity-events', 1_000);
    vi.advanceTimersByTime(2_000);
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/v1/auth/register')) return jsonResponse(200, { token: 'tok' });
      throw new Error('boom');
    });
    const result = await cachedGet('api1', 'ev', '/v1/server/api1/GameLabs/entity-events', 1_000);
    expect(result).toMatchObject({ stale: true, data: { n: 4 } });
  });
});
