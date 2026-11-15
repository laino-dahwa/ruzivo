import { NextResponse } from "next/server";
import { requireAuth } from "../../../../lib/auth/guard";
import { verifyPassword } from "../../../../lib/auth/password";
import { actorLabel } from "../../../../lib/auth/session";
import { getPasswordHash } from "../../../../repositories/auth/password";

export const runtime = "nodejs";

/**
 * Asked by the desktop app's main process - which does the actual backup or
 * restore, since only it can write folders and pick files - whether the
 * person signed in to the window may do so. It forwards the window's own
 * session cookie, so this is the same check every other admin action gets.
 *
 * A restore replaces every school's data, and linking the computer to the
 * cloud website ("sync-link") sends all of it off this computer, so both
 * also re-ask for the person's password. "backup" also covers viewing the
 * cloud sync status and syncing now.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request, "backup.manage");
    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json().catch(() => null);
    const purpose = body?.purpose;
    if (purpose !== "backup" && purpose !== "restore" && purpose !== "sync-link") {
      return NextResponse.json({ error: "Unknown purpose" }, { status: 400 });
    }

    if (purpose === "restore" || purpose === "sync-link") {
      const password = typeof body?.password === "string" ? body.password : "";
      const stored = await getPasswordHash(auth.actor.employee_id);
      if (!stored || !verifyPassword(password, stored)) {
        return NextResponse.json({ error: "Your password is incorrect." }, { status: 400 });
      }
    }

    return NextResponse.json({
      actor: {
        employee_id: auth.actor.employee_id,
        label: actorLabel(auth.actor),
        school_id: auth.actor.active_school_id,
      },
    });
  } catch (error) {
    console.error("Backup access check failed:", error);
    return NextResponse.json({ error: "Backup access check failed" }, { status: 500 });
  }
}
