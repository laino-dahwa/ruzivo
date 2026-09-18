import { NextResponse } from "next/server";
import { requireAuth, resolveSchoolScope } from "../../../../../../lib/auth/guard";
import { actorLabel } from "../../../../../../lib/auth/session";
import { listPayrollRuns, PayrollError, runPayroll } from "../../../../../../repositories/payroll/payrollRuns";

export const runtime = "nodejs";

type Params = { params: Promise<{ school_id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request, "payroll.manage");
    if (!auth.ok) return auth.response;

    const { school_id } = await params;
    const scope = resolveSchoolScope(auth.actor, school_id);
    if (!scope.ok) return scope.response;

    return NextResponse.json(await listPayrollRuns(scope.school_id));
  } catch (error) {
    console.error("List payroll runs error:", error);
    return NextResponse.json({ error: "Failed to retrieve payroll runs" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request, "payroll.manage");
    if (!auth.ok) return auth.response;

    const { school_id } = await params;
    const scope = resolveSchoolScope(auth.actor, school_id);
    if (!scope.ok) return scope.response;

    const body = await request.json().catch(() => null);
    const period_year = Number(body?.period_year);
    const period_month = Number(body?.period_month);

    if (!Number.isInteger(period_month) || period_month < 1 || period_month > 12) {
      return NextResponse.json({ error: "Choose a month." }, { status: 400 });
    }
    if (!Number.isInteger(period_year) || period_year < 2000 || period_year > 2200) {
      return NextResponse.json({ error: "Choose a year." }, { status: 400 });
    }

    const run = await runPayroll({
      school_id: scope.school_id,
      period_year,
      period_month,
      generated_by_employee_id: auth.actor.employee_id,
      generated_by_label: actorLabel(auth.actor),
    });

    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    if (error instanceof PayrollError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("Payroll run failed:", error);
    return NextResponse.json({ error: "Could not generate payroll" }, { status: 500 });
  }
}
