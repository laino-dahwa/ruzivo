import { NextResponse } from "next/server";
import { requireAuth, resolveSchoolScope } from "../../../../../../../lib/auth/guard";
import { actorLabel, revokeAllSessionsFor } from "../../../../../../../lib/auth/session";
import { resetEmployeePassword } from "../../../../../../../repositories/employee/update/resetEmployeePassword";
import { logAudit } from "../../../../../../../repositories/audit/writeAuditLog";

export const runtime = "nodejs";

type Params = { params: Promise<{ school_id: string; employee_id: string }> };

/**
 * An administrator resets someone else's password — the "Forgotten your
 * password?" path the sign-in page points to. There is no email reset: the
 * login addresses are usernames, not real mailboxes (docs/accounts-and-access.md).
 *
 * Responds with a fresh one-time password, shown once, which the employee
 * must change at next sign-in. Every session they have is ended, and any
 * lockout is cleared.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request, "user.manage");
    if (!auth.ok) return auth.response;

    const { school_id, employee_id: rawId } = await params;
    const scope = resolveSchoolScope(auth.actor, school_id);
    if (!scope.ok) return scope.response;

    const employee_id = Number.parseInt(rawId, 10);
    if (!Number.isInteger(employee_id) || employee_id < 1) {
      return NextResponse.json({ error: "employee_id must be a positive integer" }, { status: 400 });
    }

    // Your own password goes through Change password, which asks for the
    // current one — a reset here would sign you out mid-request for nothing.
    if (employee_id === auth.actor.employee_id) {
      return NextResponse.json({ error: "Use Change password to change your own password." }, { status: 400 });
    }

    const reset = await resetEmployeePassword(scope.school_id, employee_id);
    if (!reset) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    // Anything signed in with the old password stops working immediately.
    await revokeAllSessionsFor(employee_id);

    await logAudit({
      employee_id: auth.actor.employee_id,
      actor_label: actorLabel(auth.actor),
      school_id: scope.school_id,
      action: "user.password_reset",
      entity_type: "employee",
      entity_id: String(employee_id),
      summary: `${auth.actor.email} reset the password for ${reset.email}`,
    });

    return NextResponse.json(reset);
  } catch (error) {
    console.error("Password reset failed:", error);
    return NextResponse.json({ error: "Password reset failed" }, { status: 500 });
  }
}
