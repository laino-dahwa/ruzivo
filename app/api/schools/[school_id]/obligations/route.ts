import { NextResponse } from "next/server";
import { getObligations } from "../../../../../repositories/payment/read/getObligations";
import { isPdfFormat } from "../../../../../lib/reportRequest";
import { tablePdfResponse } from "../../../../../lib/pdf/tablePdfResponse";
import { formatCurrency } from "../../../../../lib/currency";

export const runtime = "nodejs";

type Params = {
    params: Promise<{ school_id: string }>;
};

function getOptionalParam(searchParams: URLSearchParams, name: string): string | null {
    const value = searchParams.get(name);
    if (!value || value === "null") {
        return null;
    }
    return value;
}

function getOptionalId(searchParams: URLSearchParams, name: string): number | null {
    const value = getOptionalParam(searchParams, name);
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Every learner's current obligations — mandatory fees even if never paid,
 * optional fees only once engaged with — filtered by id (class, learner,
 * income category, priority, status, academic year, payment period), all
 * combinable. Backs the Unpaid Mandatory Payments page.
 */
export async function GET(request: Request, { params }: Params) {
    try {
        const { school_id } = await params;
        const { searchParams } = new URL(request.url);

        const response = await getObligations(school_id, {
            class_category_id: getOptionalId(searchParams, "class_category_id"),
            learner_id: getOptionalParam(searchParams, "learner_id"),
            income_category_id: getOptionalId(searchParams, "income_category_id"),
            priority: getOptionalParam(searchParams, "priority"),
            status: getOptionalParam(searchParams, "status"),
            academic_year_id: getOptionalId(searchParams, "academic_year_id"),
            payment_period_id: getOptionalId(searchParams, "payment_period_id"),
        });

        if (isPdfFormat(searchParams)) {
            const total = response.reduce((sum, row) => sum + Number(row.balance || 0), 0);
            return tablePdfResponse({
                title: "Unpaid Mandatory Payments",
                filenameStem: "unpaid-mandatory",
                columns: [
                    { key: "learner", label: "Learner", width: 105 },
                    { key: "class", label: "Class", width: 65 },
                    { key: "income", label: "Category", width: 85 },
                    { key: "priority", label: "Priority", width: 60 },
                    { key: "period", label: "Period", width: 60 },
                    { key: "expected", label: "Expected", width: 65, align: "right" },
                    { key: "paid", label: "Paid", width: 60, align: "right" },
                    { key: "balance", label: "Outstanding", width: 70, align: "right" },
                    { key: "status", label: "Status", width: 75 },
                ],
                rows: response.map((row) => ({
                    learner: `${row.first_name} ${row.last_name}`,
                    class: row.class_name ?? "",
                    income: row.income_name ?? "",
                    priority: row.priority ?? "",
                    period: row.period_name ?? "",
                    expected: row.expected === null ? "" : formatCurrency(row.expected),
                    paid: formatCurrency(row.paid),
                    balance: row.balance === null ? "" : formatCurrency(row.balance),
                    status: statusLabel(row.status),
                })),
                totalLabel: "TOTAL OUTSTANDING",
                totalValue: formatCurrency(total),
                emptyMessage: "No obligations found.",
            });
        }

        return NextResponse.json(response);
    } catch (error) {
        console.error("Get obligations error: ", error);
        return NextResponse.json(
            { error: "Failed to retrieve obligations" },
            { status: 500 }
        );
    }
}

function statusLabel(status: string | null): string {
    switch (status) {
        case "NO_PAYMENT": return "No Payment";
        case "PARTIALLY_PAID": return "Partially Paid";
        case "FULLY_PAID": return "Fully Paid";
        default: return "";
    }
}
