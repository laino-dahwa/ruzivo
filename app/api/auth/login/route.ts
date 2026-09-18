import { NextResponse } from "next/server";
import { burnVerificationTime, verifyPassword } from "../../../../lib/auth/password";
import { createSession, deleteExpiredSessions } from "../../../../lib/auth/session";
import { setSessionCookie } from "../../../../lib/auth/cookies";
import { findEmployeeForLogin, isLocked, recordFailedLogin, recordSuccessfulLogin } from "../../../../repositories/auth/login";
import { logAudit } from "../../../../repositories/audit/writeAuditLog";
import { isAccessLevel } from "../../../../lib/auth/permissions";

export const runtime = "nodejs";

// One message for every kind of failure. Telling the caller which part was
// wrong tells an attacker which accounts exist.
const REFUSED = "Email or password is incorrect.";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json({ error: REFUSED }, { status: 401 });
    }

    const candidates = await findEmployeeForLogin(email);

    // No account, or (impossibly) an ambiguous one: spend the same time a
    // real check would, so a missing email cannot be told apart by timing.
    if (candidates.length !== 1) {
      burnVerificationTime(password);
      return NextResponse.json({ error: REFUSED }, { status: 401 });
    }

    const candidate = candidates[0];

    if (isLocked(candidate)) {
      return NextResponse.json(
        { error: "Too many failed attempts. Try again in a few minutes, or ask an administrator to unlock the account." },
        { status: 423 }
      );
    }

    if (!verifyPassword(password, candidate.password_hash)) {
      await recordFailedLogin(candidate.employee_id);
      await logAudit({
        employee_id: candidate.employee_id,
        actor_label: `${candidate.first_name} ${candidate.last_name}`.trim(),
        school_id: candidate.school_id,
        action: "auth.login_failed",
        entity_type: "employee",
        entity_id: String(candidate.employee_id),
        summary: `Failed sign-in for ${candidate.email}`,
      });
      return NextResponse.json({ error: REFUSED }, { status: 401 });
    }

    // A role carrying an access level the app does not recognise is not a
    // level to guess at — refuse rather than fall back to something.
    if (!isAccessLevel(candidate.access_level)) {
      return NextResponse.json({ error: "This account's role is not set up correctly. Ask an administrator." }, { status: 403 });
    }

    await recordSuccessfulLogin(candidate.employee_id);
    // No scheduler in this app, and an offline install may sit unused for
    // weeks — so expired rows are swept on the one path everyone takes.
    await deleteExpiredSessions();

    const { token, expiresAt } = await createSession(candidate.employee_id, candidate.school_id);

    await logAudit({
      employee_id: candidate.employee_id,
      actor_label: `${candidate.first_name} ${candidate.last_name}`.trim(),
      school_id: candidate.school_id,
      action: "auth.login",
      entity_type: "employee",
      entity_id: String(candidate.employee_id),
      summary: `${candidate.email} signed in`,
    });

    const response = NextResponse.json({
      employee_id: candidate.employee_id,
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      email: candidate.email,
      school_id: candidate.school_id,
      access_level: candidate.access_level,
      must_change_password: candidate.must_change_password,
    });

    setSessionCookie(response, request, token, expiresAt);
    return response;
  } catch (error) {
    console.error("Sign-in failed:", error);
    return NextResponse.json({ error: "Sign-in failed" }, { status: 500 });
  }
}
