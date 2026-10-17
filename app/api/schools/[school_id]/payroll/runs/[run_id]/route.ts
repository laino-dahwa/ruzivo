import { NextResponse } from "next/server";
import { requireAuth, resolveSchoolScope } from "../../../../../../../lib/auth/guard";
import { getPayrollRun } from "../../../../../../../repositories/payroll/payrollRuns";
import { getschool } from "../../../../../../../repositories/school/read/getSchool";
import { getSchoolLogo } from "../../../../../../../repositories/school/logo/schoolLogo";
import { renderPayslipsPdf } from "../../../../../../../lib/payroll/renderPayslipsPdf";
import { periodLabel } from "../../../../../../../lib/payroll/compute";
import { formatDateLabel } from "../../../../../../../lib/reportRequest";
import { localDateKey } from "../../../../../../../lib/dates";

export const runtime = "nodejs";

type Params = { params: Promise<{ school_id: string; run_id: string }> };

/** Every payslip for one month, one per page, rendered from the frozen lines. */
export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request, "payroll.manage");
    if (!auth.ok) return auth.response;

    const { school_id, run_id } = await params;
    const scope = resolveSchoolScope(auth.actor, school_id);
    if (!scope.ok) return scope.response;

    const id = Number(run_id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Unknown payroll run." }, { status: 400 });
    }

    const run = await getPayrollRun(scope.school_id, id);
    if (!run) {
      return NextResponse.json({ error: "Unknown payroll run." }, { status: 404 });
    }

    const [school] = await getschool(scope.school_id);
    const logo = await getSchoolLogo(scope.school_id, { size: 256 });
    const generatedAt = new Date(run.generated_at);

    const pdf = await renderPayslipsPdf({
      schoolName: school?.school_name ?? scope.school_id,
      schoolAddress: school?.school_address ?? null,
      schoolContact: school?.school_contact ?? null,
      logo: logo?.data ?? null,
      periodYear: run.period_year,
      periodMonth: run.period_month,
      generatedAt,
      generatedAtLabel: formatDateLabel(localDateKey(generatedAt)),
      generatedByLabel: run.generated_by_label,
      lines: run.lines,
    });

    const filename = `payslips-${run.period_year}-${String(run.period_month).padStart(2, "0")}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "X-Payroll-Period": periodLabel(run.period_year, run.period_month),
      },
    });
  } catch (error) {
    console.error("Payslip render failed:", error);
    return NextResponse.json({ error: "Could not produce the payslips" }, { status: 500 });
  }
}
