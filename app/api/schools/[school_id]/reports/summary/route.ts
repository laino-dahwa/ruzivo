import { NextResponse } from "next/server";
import { guardSchool } from "../../../../../../lib/auth/guard";
import { getReportSummary } from "../../../../../../repositories/report/getReportSummary";
import { parseReportDate, parseReportScope } from "../../../../../../lib/reportRequest";

export const runtime = "nodejs";

type Params = {
    params: Promise<{ school_id: string }>;
};

export async function GET(request: Request, { params }: Params) {
    try {
        const { school_id: requested } = await params;
        const auth = await guardSchool(request, "report.read", requested);
        if (!auth.ok) return auth.response;
        const school_id = auth.school_id;
        const { searchParams } = new URL(request.url);

        const { error } = parseReportDate(searchParams);
        const { scope } = parseReportScope(searchParams);
        if (error) {
            return NextResponse.json({ error }, { status: 400 });
        }

        const summary = await getReportSummary(school_id, scope!);
        return NextResponse.json(summary);
    } catch (error) {
        console.error("Report Summary Failed :", error);
        return NextResponse.json({ error: "Failed to generate report summary" }, { status: 500 });
    }
}
