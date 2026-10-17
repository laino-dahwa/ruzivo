import { NextResponse } from "next/server";
import {
  bootstrapAdministrator,
  BootstrapInputError,
  BootstrapUnavailableError,
  hasAdministrator,
  listSchoolsForBootstrap,
} from "../../../../repositories/auth/bootstrap";
import { validatePassword } from "../../../../lib/auth/passwordPolicy";
import { createSession } from "../../../../lib/auth/session";
import { setSessionCookie } from "../../../../lib/auth/cookies";
import { issueSecurityKey } from "../../../../repositories/auth/securityKey";

export const runtime = "nodejs";

/**
 * What the setup screen needs to render itself: whether setup is still
 * available at all, and which schools it can attach the first administrator
 * to. Returns nothing sensitive — school names only, and only while the app
 * has no administrator.
 */
export async function GET() {
  try {
    if (await hasAdministrator()) {
      return NextResponse.json({ available: false, schools: [] });
    }
    return NextResponse.json({ available: true, schools: await listSchoolsForBootstrap() });
  } catch (error) {
    console.error("Setup availability check failed:", error);
    return NextResponse.json({ error: "Setup availability check failed" }, { status: 500 });
  }
}

/**
 * Creates the first administrator. Works exactly once, ever: the repository
 * re-checks under an advisory lock inside the transaction, so two
 * simultaneous callers cannot both succeed.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    const first_name = typeof body?.first_name === "string" ? body.first_name.trim() : "";
    const last_name = typeof body?.last_name === "string" ? body.last_name.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!first_name || !last_name) {
      return NextResponse.json({ error: "First name and last name are required." }, { status: 400 });
    }

    const passwordError = validatePassword(password, { firstName: first_name, lastName: last_name });
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const created = await bootstrapAdministrator({
      first_name,
      last_name,
      password,
      school_id: typeof body?.school_id === "string" ? body.school_id : undefined,
      new_school: body?.new_school ?? undefined,
    });

    // Signed straight in — they just proved who they are by creating the
    // account, and a sign-in form immediately afterwards is pure friction.
    // The first administrator gets a security key straight away: if they are
    // ever the only administrator and forget their password, there is nobody
    // else to reset it. Shown once on the setup screen.
    const security_key = await issueSecurityKey(created.employee_id);

    const { token, expiresAt } = await createSession(created.employee_id, created.school_id);

    const response = NextResponse.json({ ...created, security_key }, { status: 201 });
    setSessionCookie(response, request, token, expiresAt);
    return response;
  } catch (error) {
    if (error instanceof BootstrapUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof BootstrapInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("Setup failed:", error);
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}
