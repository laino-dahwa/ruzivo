import { NextResponse } from "next/server";
import { requireAuth, resolveSchoolScope } from "../../../../../lib/auth/guard";
import { getExpectedFees } from "../../../../../repositories/expected-fees/getExpectedFees";
import { isPdfFormat } from "../../../../../lib/reportRequest";
import { tablePdfResponse } from "../../../../../lib/pdf/tablePdfResponse";
import { formatCurrency } from "../../../../../lib/currency";
import { isExpectedFeeDecision, type ExpectedFeeDecision, type FeePriority } from "../../../../../types/expected-fees";

export const runtime = "nodejs";

type Params = {
    params: Promise<{ school_id: string }>;
};

function getOptionalParam(searchParams: URLSearchParams, name: string): string | null {
    const value = searchParams.get(name);
    if (!value || value === "null") return null;
    return value;
}

function getOptionalId(searchParams: URLSearchParams, name: string): number | null {
    const value = getOptionalParam(searchParams, name);
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const PRIORITIES: readonly string[] = ["MANDATORY", "OPTIONAL", "ONCE_OFF"];

const DECISION_TITLE: Record<ExpectedFeeDecision, string> = {
    PENDING: "Expected fees awaiting confirmation",
    ACCEPTED: "Accepted expected fees",
    SKIPPED: "Expected fees denied for one period",
    EXEMPT: "Expected fees denied forever",
};

/**
 * Expected fees in one decision state (PENDING by default), filtered by id:
 * class, learner, fee, priority, academic year and payment period, all
 * combinable. Backs the Expected fees page; `?format=pdf` downloads the same
 * rows as a table.
 */
export async function GET(request: Request, { params }: Params) {
    try {
        const auth = await requireAuth(request, "obligation.read");
        if (!auth.ok) return auth.response;

        const { school_id } = await params;
        const scope = resolveSchoolScope(auth.actor, school_id);
        if (!scope.ok) return scope.response;

        const { searchParams } = new URL(request.url);
        const decisionParam = getOptionalParam(searchParams, "decision");
        if (decisionParam !== null && !isExpectedFeeDecision(decisionParam)) {
            return NextResponse.json({ error: "Unknown decision filter." }, { status: 400 });
        }
        const priorityParam = getOptionalParam(searchParams, "priority");
        if (priorityParam !== null && !PRIORITIES.includes(priorityParam)) {
            return NextResponse.json({ error: "Unknown priority." }, { status: 400 });
        }

        const decision: ExpectedFeeDecision = decisionParam ?? "PENDING";
        const rows = await getExpectedFees(scope.school_id, {
            decision,
            class_category_id: getOptionalId(searchParams, "class_category_id"),
            learner_id: getOptionalParam(searchParams, "learner_id"),
            income_category_id: getOptionalId(searchParams, "income_category_id"),
            priority: priorityParam as FeePriority | null,
            academic_year_id: getOptionalId(searchParams, "academic_year_id"),
            payment_period_id: getOptionalId(searchParams, "payment_period_id"),
        });

        if (isPdfFormat(searchParams)) {
            const exempt = decision === "EXEMPT";
            const total = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
            return tablePdfResponse({
                title: DECISION_TITLE[decision],
                filenameStem: "expected-fees",
                columns: [
                    { key: "learner", label: "Learner", width: 120 },
                    { key: "class", label: "Class", width: 70 },
                    { key: "income", label: "Fee", width: 95 },
                    { key: "priority", label: "Priority", width: 65 },
                    exempt
                        ? { key: "reason", label: "Reason", width: 135 }
                        : { key: "period", label: "Period", width: 135 },
                    { key: "amount", label: "Amount", width: 75, align: "right" },
                ],
                rows: rows.map((row) => ({
                    learner: `${row.first_name} ${row.last_name}`,
                    class: row.class_name ?? "",
                    income: row.income_name,
                    priority: priorityLabel(row.priority),
                    period: [row.period_name, row.academic_year_name].filter(Boolean).join(" · "),
                    reason: row.reason ?? "",
                    amount: row.amount === null ? "" : formatCurrency(row.amount),
                })),
                totalLabel: decision === "PENDING" ? "TOTAL AWAITING CONFIRMATION" : "TOTAL",
                totalValue: formatCurrency(total),
                emptyMessage: "No expected fees match these filters.",
            });
        }

        return NextResponse.json(rows);
    } catch (error) {
        console.error("Get expected fees error: ", error);
        return NextResponse.json({ error: "Failed to retrieve expected fees" }, { status: 500 });
    }
}

function priorityLabel(priority: FeePriority): string {
    return priority === "MANDATORY" ? "Mandatory" : priority === "ONCE_OFF" ? "Once-off" : "Optional";
}
