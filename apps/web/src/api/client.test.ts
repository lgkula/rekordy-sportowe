import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, setUnauthorizedHandler } from './client';

function mockFetch(response: Response | Error) {
  const fn = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(() => {});
});

describe('apiFetch', () => {
  it('sends JSON bodies and parses JSON responses', async () => {
    const fetch = mockFetch(json(200, { role: 'viewer' }));
    await expect(apiFetch('/api/x', { method: 'POST', body: { a: 1 } })).resolves.toEqual({
      role: 'viewer',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/x',
      expect.objectContaining({
        method: 'POST',
        body: '{"a":1}',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
      }),
    );
  });

  it('omits the JSON content type without a body', async () => {
    const fetch = mockFetch(new Response(null, { status: 204 }));
    await expect(apiFetch('/api/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).not.toHaveProperty('content-type');
  });

  it('sends FormData as is, letting the browser set the multipart type', async () => {
    const fetch = mockFetch(json(201, { id: 1 }));
    const form = new FormData();
    form.append('meta', '{}');
    await apiFetch('/api/import/fit', { method: 'POST', body: form });
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBe(form);
    expect(init.headers).not.toHaveProperty('content-type');
  });

  it('throws ApiError with the status, server message and body', async () => {
    const body = { error: 'Brak uprawnień.', code: 'x' };
    mockFetch(json(403, body));
    await expect(apiFetch('/api/x')).rejects.toEqual(new ApiError(403, 'Brak uprawnień.', body));
  });

  it('reports an unreachable server as status 0', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ status: 0 });
  });

  it('calls the unauthorized handler on 401, except for auth endpoints', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(json(401, { error: 'x' }));
    await expect(apiFetch('/api/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
    mockFetch(json(401, { error: 'x' }));
    await expect(apiFetch('/api/records')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
  });
});
