import { NextResponse } from "next/server";
import { readSessionCookie } from "./cookies";
import { findSessionByToken, type Actor } from "./session";
import { can, type Capability } from "./permissions";

export type GuardResult =
  | { ok: true; actor: Actor; token: string }
  | { ok: false; response: NextResponse };

function deny(status: number, error: string): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/**
 * The authorisation check every API route calls first.
 *
 * ```ts
 * const auth = await requireAuth(request, "payment.create");
 * if (!auth.ok) return auth.response;
 * const { employee_id, active_school_id } = auth.actor;
 * ```
 *
 * 401 means "not signed in", 403 means "signed in, not allowed" — the client
 * treats the two differently (redirect to login vs. show a refusal).
 *
 * This lives in the handler rather than in middleware on purpose. The API
 * test suites call route handlers directly as functions, which bypasses
 * middleware entirely; a check that lived only there would be enforced in
 * production and completely untested.
 */
export async function requireAuth(request: Request, capability: Capability): Promise<GuardResult> {
  const token = readSessionCookie(request);
  if (!token) {
    return deny(401, "Sign in to continue.");
  }

  const actor = await findSessionByToken(token);
  if (!actor) {
    return deny(401, "Your session has expired. Sign in again.");
  }

  // Enforced here, not just by a redirect in the layout: a UI-only gate is
  // bypassed by a single fetch. The change-password endpoint is the only one
  // that may be called while this is set, and it does not use this guard.
  if (actor.must_change_password) {
    return deny(403, "You must change your password before continuing.");
  }

  if (!can(actor.access_level, capability)) {
    return deny(403, "You do not have permission to do that.");
  }

  return { ok: true, actor, token };
}

/**
 * Like requireAuth, but for the change-password endpoint, which must work
 * precisely while `must_change_password` is set.
 */
export async function requireSession(request: Request): Promise<GuardResult> {
  const token = readSessionCookie(request);
  if (!token) {
    return deny(401, "Sign in to continue.");
  }

  const actor = await findSessionByToken(token);
  if (!actor) {
    return deny(401, "Your session has expired. Sign in again.");
  }

  return { ok: true, actor, token };
}

/**
 * Resolves which school a request is allowed to act on.
 *
 * `requested` is whatever the client asked for — a path param or query
 * string. It is never obeyed on its own: an administrator may act on any
 * school, and anyone else is confined to the school their session is on.
 * Passing `null` means "use the session's school", which is what most routes
 * should do.
 */
export function resolveSchoolScope(actor: Actor, requested: string | null): { ok: true; school_id: string } | { ok: false; response: NextResponse } {
  if (!requested || requested === actor.active_school_id) {
    return { ok: true, school_id: actor.active_school_id };
  }

  if (actor.access_level === "ADMIN") {
    return { ok: true, school_id: requested };
  }

  // Deliberately the same message as any other refusal: whether the school
  // exists is not something to confirm to someone who may not see it.
  return { ok: false, response: NextResponse.json({ error: "You do not have permission to do that." }, { status: 403 }) };
}
