import type { NextResponse } from "next/server";

export const SESSION_COOKIE = "ssv_session";

/**
 * Reads the session cookie off the Request rather than via `cookies()` from
 * next/headers.
 *
 * This is load-bearing, not a style choice: the API test suites import route
 * handlers and call them as plain functions, outside Next's async request
 * context, where `cookies()` throws. Taking the header off the Request the
 * handler was already given keeps every route testable exactly as it is
 * today — and works identically in production.
 */
export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) {
    return null;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return null;
}

/**
 * `Secure` only when actually served over HTTPS. The desktop build runs the
 * Next server on plain http://127.0.0.1:3100, and a Secure cookie there is
 * silently dropped by the browser — which would present as "login appears to
 * succeed but every subsequent request is unauthenticated".
 */
function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export function setSessionCookie(response: NextResponse, request: Request, token: string, expiresAt: Date): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse, request: Request): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: 0,
  });
}
