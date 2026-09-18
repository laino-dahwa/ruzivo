import { NextResponse } from "next/server";
import { requireSession } from "../../../../lib/auth/guard";
import { verifyPassword } from "../../../../lib/auth/password";
import { validatePassword } from "../../../../lib/auth/passwordPolicy";
import { getPasswordHash, setPassword } from "../../../../repositories/auth/password";
import { actorLabel, createSession, revokeAllSessionsFor } from "../../../../lib/auth/session";
import { setSessionCookie } from "../../../../lib/auth/cookies";
import { logAudit } from "../../../../repositories/audit/writeAuditLog";

export const runtime = "nodejs";

/**
 * Changes your own password.
 *
 * Uses requireSession rather than requireAuth because this is the one
 * endpoint that must work *while* must_change_password is set — that flag is
 * precisely what sends someone here.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json().catch(() => null);
    const current = typeof body?.current_password === "string" ? body.current_password : "";
    const next = typeof body?.new_password === "string" ? body.new_password : "";

    const stored = await getPasswordHash(auth.actor.employee_id);
    if (!stored || !verifyPassword(current, stored)) {
      return NextResponse.json({ error: "Your current password is incorrect." }, { status: 400 });
    }

    const policyError = validatePassword(next, {
      email: auth.actor.email,
      firstName: auth.actor.first_name,
      lastName: auth.actor.last_name,
    });
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    if (next === current) {
      return NextResponse.json({ error: "Choose a password you have not used already." }, { status: 400 });
    }

    await setPassword(auth.actor.employee_id, next);

    // Everything signed in with the old password stops working, including
    // this request's own session — so a fresh one is issued below.
    await revokeAllSessionsFor(auth.actor.employee_id);
    const { token, expiresAt } = await createSession(auth.actor.employee_id, auth.actor.active_school_id);

    await logAudit({
      employee_id: auth.actor.employee_id,
      actor_label: actorLabel(auth.actor),
      school_id: auth.actor.active_school_id,
      action: "auth.password_change",
      entity_type: "employee",
      entity_id: String(auth.actor.employee_id),
      summary: `${auth.actor.email} changed their password`,
    });

    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, request, token, expiresAt);
    return response;
  } catch (error) {
    console.error("Password change failed:", error);
    return NextResponse.json({ error: "Password change failed" }, { status: 500 });
  }
}
