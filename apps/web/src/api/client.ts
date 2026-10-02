/** Error from an API call: `status` is the HTTP status, or 0 when the server was unreachable. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** Called when any non-auth API call answers 401 (session expired or revoked). */
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

type ApiRequest = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown };

/** JSON fetch against our API. The session cookie travels automatically (same origin). */
export async function apiFetch<T>(
  path: string,
  { method = 'GET', body }: ApiRequest = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        // Fastify rejects an empty body declared as JSON, so set it only with a body.
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(0, error instanceof Error ? error.message : String(error));
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) unauthorizedHandler?.();
    const message = (data as { error?: unknown } | null)?.error;
    throw new ApiError(res.status, typeof message === 'string' ? message : `HTTP ${res.status}`);
  }
  return data as T;
}
