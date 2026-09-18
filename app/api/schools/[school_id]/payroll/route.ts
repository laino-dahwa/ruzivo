import { NextResponse } from "next/server";
import { requireAuth, resolveSchoolScope } from "../../../../../lib/auth/guard";
import { actorLabel } from "../../../../../lib/auth/session";
import { EmployeePayError, listEmployeePay, updateEmployeePay } from "../../../../../repositories/payroll/employeePay";
import { logAudit } from "../../../../../repositories/audit/writeAuditLog";

export const runtime = "nodejs";

type Params = { params: Promise<{ school_id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request, "payroll.manage");
    if (!auth.ok) return auth.response;

    const { school_id } = await params;
    const scope = resolveSchoolScope(auth.actor, school_id);
    if (!scope.ok) return scope.response;

    return NextResponse.json(await listEmployeePay(scope.school_id));
  } catch (error) {
    console.error("Get payroll error:", error);
    return NextResponse.json({ error: "Failed to retrieve payroll" }, { status: 500 });
  }
}

/** A number that may legitimately be absent (an unset salary), else 0. */
function optionalAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function amountOrZero(value: unknown): number {
  return optionalAmount(value) ?? 0;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request, "payroll.manage");
    if (!auth.ok) return auth.response;

    const { school_id } = await params;
    const scope = resolveSchoolScope(auth.actor, school_id);
    if (!scope.ok) return scope.response;

    const body = await request.json().catch(() => null);
    const employee_id = Number(body?.employee_id);

    if (!Number.isInteger(employee_id)) {
      return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
    }

    // A negative figure is rejected rather than clamped: silently turning
    // -500 into 0 would hide a typo in somebody's pay.
    for (const field of ["basic_salary", "transport_allowance", "housing_allowance", "paye_deduction", "pension_deduction"]) {
      const raw = body?.[field];
      if (raw !== null && raw !== undefined && raw !== "" && !(Number(raw) >= 0)) {
        return NextResponse.json({ error: "Pay amounts must be zero or more." }, { status: 400 });
      }
    }

    const updated = await updateEmployeePay(scope.school_id, {
      employee_id,
      basic_salary: optionalAmount(body?.basic_salary),
      transport_allowance: amountOrZero(body?.transport_allowance),
      housing_allowance: amountOrZero(body?.housing_allowance),
      paye_deduction: amountOrZero(body?.paye_deduction),
      pension_deduction: amountOrZero(body?.pension_deduction),
    });

    // Pay changes are worth a trail of their own, separately from the
    // payroll runs that later freeze them.
    await logAudit({
      employee_id: auth.actor.employee_id,
      actor_label: actorLabel(auth.actor),
      school_id: scope.school_id,
      action: "payroll.pay_change",
      entity_type: "employee",
      entity_id: String(employee_id),
      summary: `Updated pay details for employee ${employee_id}`,
      detail: updated,
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof EmployeePayError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error("Update payroll error:", error);
    return NextResponse.json({ error: "Could not update pay details" }, { status: 500 });
  }
}
