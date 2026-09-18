import { NextResponse } from "next/server";
import { clearSessionCookie, readSessionCookie } from "../../../../lib/auth/cookies";
import { findSessionByToken, revokeSession, actorLabel } from "../../../../lib/auth/session";
import { logAudit } from "../../../../repositories/audit/writeAuditLog";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const token = readSessionCookie(request);

    if (token) {
      // Read the actor before revoking, so the audit entry has a name on it.
      const actor = await findSessionByToken(token);
      await revokeSession(token);

      if (actor) {
        await logAudit({
          employee_id: actor.employee_id,
          actor_label: actorLabel(actor),
          school_id: actor.active_school_id,
          action: "auth.logout",
          entity_type: "employee",
          entity_id: String(actor.employee_id),
          summary: `${actor.email} signed out`,
        });
      }
    }

    // Always reports success: signing out with an already-dead session is
    // the outcome the caller wanted anyway.
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response, request);
    return response;
  } catch (error) {
    console.error("Sign-out failed:", error);
    return NextResponse.json({ error: "Sign-out failed" }, { status: 500 });
  }
}
