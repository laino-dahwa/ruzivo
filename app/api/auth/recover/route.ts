import { NextResponse } from "next/server";
import { burnVerificationTime, verifyPassword } from "../../../../lib/auth/password";
import { validatePassword } from "../../../../lib/auth/passwordPolicy";
import { normaliseSecurityKey } from "../../../../lib/auth/securityKey";
import { createSession, revokeAllSessionsFor } from "../../../../lib/auth/session";
import { setSessionCookie } from "../../../../lib/auth/cookies";
import { isAccessLevel } from "../../../../lib/auth/permissions";
import { findEmployeeForLogin, isLocked, recordFailedLogin } from "../../../../repositories/auth/login";
import { setPassword } from "../../../../repositories/auth/password";
import { issueSecurityKey } from "../../../../repositories/auth/securityKey";
import { logAudit } from "../../../../repositories/audit/writeAuditLog";

export const runtime = "nodejs";

// One message for every way the email/key pair can be wrong — the same rule
// as sign-in: saying which part failed says which accounts exist, or have keys.
const REFUSED = "Email or security key is incorrect.";

/**
 * Forgotten password: proves who you are with your security key instead,
 * sets a new password and signs you in.
 *
 * Behaves like sign-in where it matters: the same timing whether or not the
 * email exists, and failures count towards the same lockout, so a key cannot
 * be guessed any faster than a password. On success the key is used up and
 * a fresh one is returned (shown once), every other session ends, and any
 * lockout is cleared.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const key = normaliseSecurityKey(typeof body?.security_key === "string" ? body.security_key : "");
    const newPassword = typeof body?.new_password === "string" ? body.new_password : "";

    if (!email || !key) {
      return NextResponse.json({ error: REFUSED }, { status: 401 });
    }

    const candidates = await findEmployeeForLogin(email);
    if (candidates.length !== 1) {
      burnVerificationTime(key);
      return NextResponse.json({ error: REFUSED }, { status: 401 });
    }

    const candidate = candidates[0];
    const label = `${candidate.first_name} ${candidate.last_name}`.trim();

    if (isLocked(candidate)) {
      return NextResponse.json({ error: "Too many failed attempts. Try again in a few minutes." }, { status: 423 });
    }

    // An account with no key is answered exactly like a wrong key, in the
    // same time.
    let keyMatches = false;
    if (candidate.security_key_hash) {
      keyMatches = verifyPassword(key, candidate.security_key_hash);
    } else {
      burnVerificationTime(key);
    }
    if (!keyMatches) {
      await recordFailedLogin(candidate.employee_id);
      await logAudit({
        employee_id: candidate.employee_id,
        actor_label: label,
        school_id: candidate.school_id,
        action: "auth.recovery_failed",
        entity_type: "employee",
        entity_id: String(candidate.employee_id),
        summary: `Failed security key recovery for ${candidate.email}`,
      });
      return NextResponse.json({ error: REFUSED }, { status: 401 });
    }

    if (!isAccessLevel(candidate.access_level)) {
      return NextResponse.json({ error: "This account's role is not set up correctly. Ask an administrator." }, { status: 403 });
    }

    // Checked only once the key is proven, so it gives nothing away.
    const policyError = validatePassword(newPassword, {
      email: candidate.email,
      firstName: candidate.first_name,
      lastName: candidate.last_name,
    });
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }

    // Clears the lockout and any must-change flag along with the password.
    await setPassword(candidate.employee_id, newPassword);
    // The key has now been typed in somewhere; it is never good twice.
    const security_key = await issueSecurityKey(candidate.employee_id);
    await revokeAllSessionsFor(candidate.employee_id);
    const { token, expiresAt } = await createSession(candidate.employee_id, candidate.school_id);

    await logAudit({
      employee_id: candidate.employee_id,
      actor_label: label,
      school_id: candidate.school_id,
      action: "auth.recovered",
      entity_type: "employee",
      entity_id: String(candidate.employee_id),
      summary: `${candidate.email} reset their password with their security key`,
    });

    const response = NextResponse.json({
      employee_id: candidate.employee_id,
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      email: candidate.email,
      school_id: candidate.school_id,
      access_level: candidate.access_level,
      must_change_password: false,
      security_key,
    });
    setSessionCookie(response, request, token, expiresAt);
    return response;
  } catch (error) {
    console.error("Security key recovery failed:", error);
    return NextResponse.json({ error: "Recovery failed" }, { status: 500 });
  }
}
