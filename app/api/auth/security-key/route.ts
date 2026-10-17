import { NextResponse } from "next/server";
import { requireSession } from "../../../../lib/auth/guard";
import { verifyPassword } from "../../../../lib/auth/password";
import { actorLabel } from "../../../../lib/auth/session";
import { getPasswordHash } from "../../../../repositories/auth/password";
import { getSecurityKeyStatus, issueSecurityKey } from "../../../../repositories/auth/securityKey";
import { logAudit } from "../../../../repositories/audit/writeAuditLog";

export const runtime = "nodejs";

/** Whether you have a security key, and when it was made. Never the key itself. */
export async function GET(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;
    return NextResponse.json(await getSecurityKeyStatus(auth.actor.employee_id));
  } catch (error) {
    console.error("Security key status failed:", error);
    return NextResponse.json({ error: "Could not check your security key" }, { status: 500 });
  }
}

/**
 * Makes you a new security key, replacing any old one, and returns it once.
 *
 * Asks for your current password first: a key is a second way into the
 * account, so a session left open on a shared machine must not be enough to
 * mint one. Not available while a temporary password is still in force —
 * choose your own password first.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

    if (auth.actor.must_change_password) {
      return NextResponse.json({ error: "Choose your own password before making a security key." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const current = typeof body?.current_password === "string" ? body.current_password : "";
    const stored = await getPasswordHash(auth.actor.employee_id);
    if (!stored || !verifyPassword(current, stored)) {
      return NextResponse.json({ error: "Your current password is incorrect." }, { status: 400 });
    }

    const security_key = await issueSecurityKey(auth.actor.employee_id);

    await logAudit({
      employee_id: auth.actor.employee_id,
      actor_label: actorLabel(auth.actor),
      school_id: auth.actor.active_school_id,
      action: "auth.security_key_created",
      entity_type: "employee",
      entity_id: String(auth.actor.employee_id),
      summary: `${auth.actor.email} made a new security key`,
    });

    return NextResponse.json({ security_key });
  } catch (error) {
    console.error("Security key creation failed:", error);
    return NextResponse.json({ error: "Could not make a security key" }, { status: 500 });
  }
}
