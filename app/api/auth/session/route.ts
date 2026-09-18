import { NextResponse } from "next/server";
import { readSessionCookie } from "../../../../lib/auth/cookies";
import { findSessionByToken, setActiveSchool } from "../../../../lib/auth/session";
import { hasAdministrator } from "../../../../repositories/auth/bootstrap";
import { query } from "../../../../lib/db";

export const runtime = "nodejs";

/**
 * Who am I? The client calls this on load to decide between the setup
 * screen, the sign-in screen, and the app itself.
 *
 * Answers 200 with `actor: null` rather than 401 when nobody is signed in —
 * "there is no session" is the expected answer here, not a failure.
 */
export async function GET(request: Request) {
  try {
    const token = readSessionCookie(request);
    const actor = token ? await findSessionByToken(token) : null;

    if (!actor) {
      // Only consulted when signed out, so a signed-in app never pays for it.
      return NextResponse.json({ actor: null, needs_setup: !(await hasAdministrator()) });
    }

    return NextResponse.json({ actor, needs_setup: false });
  } catch (error) {
    console.error("Session lookup failed:", error);
    return NextResponse.json({ error: "Session lookup failed" }, { status: 500 });
  }
}

/**
 * Switches which school the session is acting on. Administrators only —
 * a cashier is pinned to their own school for the life of the session.
 */
export async function PATCH(request: Request) {
  try {
    const token = readSessionCookie(request);
    const actor = token ? await findSessionByToken(token) : null;

    if (!token || !actor) {
      return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    }

    if (actor.access_level !== "ADMIN") {
      return NextResponse.json({ error: "You do not have permission to do that." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const schoolId = typeof body?.school_id === "string" ? body.school_id.trim() : "";

    if (!schoolId) {
      return NextResponse.json({ error: "school_id is required" }, { status: 400 });
    }

    const school = await query(`SELECT school_id FROM schools WHERE school_id = $1`, [schoolId]);
    if ((school.rowCount ?? 0) === 0) {
      return NextResponse.json({ error: "That school does not exist." }, { status: 404 });
    }

    await setActiveSchool(token, schoolId);

    return NextResponse.json({ ...actor, active_school_id: schoolId });
  } catch (error) {
    console.error("School switch failed:", error);
    return NextResponse.json({ error: "School switch failed" }, { status: 500 });
  }
}
