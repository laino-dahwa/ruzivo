import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./cookies";
import { findSessionByToken, type Actor } from "./session";
import { can, LANDING_ROUTE, type Capability } from "./permissions";
import { hasAdministrator } from "../../repositories/auth/bootstrap";

/**
 * Page-level gating for server components.
 *
 * Separate from lib/auth/guard.ts on purpose. That one guards API routes and
 * reads the cookie off a Request so the handler tests can drive it; this one
 * runs inside a real rendering request, where `cookies()` is available and
 * `redirect()` is the right way to refuse.
 *
 * This is presentation, not protection: it stops someone being shown a page
 * that would only fill with permission errors. The actual control is the API
 * guard, which is enforced regardless of how the request was made.
 */

/**
 * Memoised per request: the layout and the page both need the actor, and
 * looking it up twice would also slide the session's expiry twice.
 */
export const getPageActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  return findSessionByToken(token);
});

export async function requireSignedIn(): Promise<Actor> {
  const actor = await getPageActor();

  if (!actor) {
    // A database with no administrator has not been set up yet, so send them
    // to create one rather than to a sign-in form nobody can satisfy.
    if (!(await hasAdministrator())) {
      redirect("/setup");
    }
    redirect("/login");
  }

  if (actor.must_change_password) {
    redirect("/change-password");
  }

  return actor;
}

/**
 * Sends someone who cannot see this page back to their own landing page,
 * rather than showing an error — for a cashier, /reports simply is not part
 * of the app.
 */
export async function requirePageAccess(capability: Capability): Promise<Actor> {
  const actor = await requireSignedIn();

  if (!can(actor.access_level, capability)) {
    redirect(LANDING_ROUTE[actor.access_level]);
  }

  return actor;
}
