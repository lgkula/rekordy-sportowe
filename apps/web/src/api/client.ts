/** Error from an API call: `status` is the HTTP status, or 0 when the server was unreachable. */
export class ApiError extends Error {
  readonly status: number;
  /** Parsed JSON error body (e.g. a duplicate conflict), or null. */
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** Called when any non-auth API call answers 401 (session expired or revoked). */
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

type ApiRequest = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown };

/**
 * Fetch against our API: a JSON body, or `FormData` for file uploads (multipart). The answer
 * is JSON. The session cookie travels automatically (same origin).
 */
export async function apiFetch<T>(
  path: string,
  { method = 'GET', body }: ApiRequest = {},
): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        // Fastify rejects an empty body declared as JSON, so set it only with a body. The
        // browser sets the multipart content type (with its boundary) for FormData.
        ...(body === undefined || isForm ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(0, error instanceof Error ? error.message : String(error));
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) unauthorizedHandler?.();
    const message = (data as { error?: unknown } | null)?.error;
    throw new ApiError(
      res.status,
      typeof message === 'string' ? message : `HTTP ${res.status}`,
      data,
    );
  }
  return data as T;
}
