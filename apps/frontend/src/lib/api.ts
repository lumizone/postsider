/**
 * Tiny fetch wrapper for the PostSider backend.
 *
 * Auth model (production): the backend issues the JWT as an httpOnly, secure,
 * sameSite cookie. The browser sends it automatically because every request
 * uses `credentials: "include"`. The token is never readable from JavaScript,
 * so it is not exposed to XSS.
 *
 * Auth model (dev / NOT_SECURED): when the backend runs with NOT_SECURED it
 * cannot set cross-site secure cookies, so it mirrors the JWT in the `auth`
 * response header. In that mode only, we persist the token in localStorage and
 * send it back as the `auth` request header. This path is a development
 * convenience and MUST NOT be used in production.
 *
 * The wrapper auto-redirects to /login on 401/403 so callers never have to
 * worry about expired sessions.
 */

const TOKEN_KEY = "postsider:auth";
const ORG_KEY = "postsider:showorg";

export const TOKEN_HEADER = "auth";
export const ORG_HEADER = "showorg";

function getBackendUrl(): string {
  // Browser: use the public URL Next bakes into the bundle. Server-side:
  // prefer BACKEND_INTERNAL_URL when set so SSR talks to the backend over
  // the docker/internal network.
  if (typeof window === "undefined") {
    return (
      process.env.BACKEND_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      "http://localhost:3000"
    );
  }
  return process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export function getOrgId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

export function setOrgId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(ORG_KEY, id);
    else window.localStorage.removeItem(ORG_KEY);
  } catch {}
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

interface ApiOptions extends Omit<RequestInit, "body" | "headers"> {
  body?: unknown;
  headers?: Record<string, string>;
  /** Skip auth token and org headers (e.g. login/register). */
  anonymous?: boolean;
  /** When true, do not auto-redirect on 401/403. */
  silent?: boolean;
  /** Treat as multipart/form-data; pass body as FormData. */
  form?: boolean;
}

function buildUrl(path: string, query?: Record<string, string | number | boolean | undefined | null>): string {
  const base = getBackendUrl().replace(/\/$/, "");
  const safePath = path.startsWith("/") ? path : `/${path}`;
  if (!query) return `${base}${safePath}`;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${base}${safePath}?${qs}` : `${base}${safePath}`;
}

async function request<T>(
  method: string,
  path: string,
  opts: ApiOptions = {},
): Promise<T> {
  const { body, headers = {}, anonymous, silent, form, ...rest } = opts;

  const finalHeaders: Record<string, string> = {
    ...(form ? {} : { "Content-Type": "application/json" }),
    ...headers,
  };

  if (!anonymous) {
    // Dev-only fallback: when the backend runs with NOT_SECURED it cannot set
    // cross-site secure cookies, so it mirrors the token in headers and we
    // replay it. In production (cookie mode) the token lives in an httpOnly
    // cookie and is sent automatically via credentials:"include" below.
    const token = getAuthToken();
    if (token) finalHeaders[TOKEN_HEADER] = token;
    const org = getOrgId();
    if (org) finalHeaders[ORG_HEADER] = org;
  }

  let payload: BodyInit | undefined;
  if (form && body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
  }

  const res = await fetch(path.startsWith("http") ? path : buildUrl(path), {
    method,
    headers: finalHeaders,
    body: payload,
    // Always send/receive cookies so the httpOnly auth cookie flows in
    // production. Harmless in dev (NOT_SECURED) where headers are also used.
    credentials: "include",
    ...rest,
  });

  // Pick up rotated auth/org cookies that the backend mirrors as headers.
  const newAuth = res.headers.get("auth");
  if (newAuth) setAuthToken(newAuth);
  const newOrg = res.headers.get("showorg");
  if (newOrg) setOrgId(newOrg);
  if (res.headers.get("logout") === "true") {
    setAuthToken(null);
    setOrgId(null);
  }

  if (!res.ok) {
    let parsed: unknown = null;
    const text = await res.text().catch(() => "");
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    // Only an UNAUTHENTICATED response (401 = no/expired session) logs the user
    // out. A 403 is a permission/plan gate on an already-authenticated user
    // (e.g. a superadmin-only storage endpoint, an admin-only API-keys list, a
    // paid-feature route) — it must NOT log them out; the calling page shows the
    // error. Logging out on any 403 wrongly kicked users off gated settings
    // pages. Session revocation still surfaces as a 401 on the next request.
    if (
      !silent &&
      res.status === 401 &&
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/login") &&
      !window.location.pathname.startsWith("/register")
    ) {
      setAuthToken(null);
      setOrgId(null);
      window.location.href = "/login";
    }

    const message =
      (parsed && typeof parsed === "object" && ("message" in parsed || "msg" in parsed)
        ? String((parsed as { message?: unknown; msg?: unknown }).message ?? (parsed as { msg?: unknown }).msg)
        : typeof parsed === "string"
          ? parsed
          : res.statusText) || `HTTP ${res.status}`;
    throw new ApiError(res.status, message, parsed);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await res.json()) as T;
  }
  // Text-fallback for endpoints that return text.
  return (await res.text()) as unknown as T;
}

export const api = {
  get<T>(path: string, query?: Record<string, string | number | boolean | undefined | null>, opts?: ApiOptions) {
    return request<T>("GET", buildUrl(path, query), opts);
  },
  post<T>(path: string, body?: unknown, opts?: ApiOptions) {
    return request<T>("POST", buildUrl(path), { ...opts, body });
  },
  put<T>(path: string, body?: unknown, opts?: ApiOptions) {
    return request<T>("PUT", buildUrl(path), { ...opts, body });
  },
  del<T>(path: string, body?: unknown, opts?: ApiOptions) {
    return request<T>("DELETE", buildUrl(path), { ...opts, body });
  },
  upload<T>(path: string, form: FormData, opts?: ApiOptions) {
    return request<T>("POST", buildUrl(path), { ...opts, body: form, form: true });
  },
};
