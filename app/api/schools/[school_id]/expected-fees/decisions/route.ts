import { NextResponse } from "next/server";
import { requireAuth, resolveSchoolScope } from "../../../../../../lib/auth/guard";
import { actorLabel } from "../../../../../../lib/auth/session";
import { parseExpectedFeeAction } from "../../../../../../lib/expected-fees/parseAction";
import { applyExpectedFeeAction } from "../../../../../../repositories/expected-fees/decideExpectedFees";

export const runtime = "nodejs";

type Params = {
    params: Promise<{ school_id: string }>;
};

/**
 * Accept, deny (for this period or forever) or undo expected fees. Body:
 * `{ action, items, reason? }` - see ExpectedFeeAction in types/expected-fees.ts.
 * Answers with how many fees changed, so the page can say when some had
 * already been dealt with by someone else.
 */
export async function POST(request: Request, { params }: Params) {
    try {
        const auth = await requireAuth(request, "obligation.decide");
        if (!auth.ok) return auth.response;

        const { school_id } = await params;
        const scope = resolveSchoolScope(auth.actor, school_id);
        if (!scope.ok) return scope.response;

        const parsed = parseExpectedFeeAction(await request.json().catch(() => null));
        if (!parsed.ok) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }

        const result = await applyExpectedFeeAction(scope.school_id, parsed.action, {
            employee_id: auth.actor.employee_id,
            label: actorLabel(auth.actor),
        });

        return NextResponse.json(result);
    } catch (error) {
        console.error("Expected fee decision error: ", error);
        return NextResponse.json({ error: "Could not save the decision" }, { status: 500 });
    }
}
