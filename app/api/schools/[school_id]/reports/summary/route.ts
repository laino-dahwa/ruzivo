import { NextResponse } from "next/server";
import { getReportSummary } from "../../../../../../repositories/report/getReportSummary";
import { parseReportDate } from "../../../../../../lib/reportRequest";

export const runtime = "nodejs";

type Params = {
    params: Promise<{ school_id: string }>;
};

export async function GET(request: Request, { params }: Params) {
    try {
        const { school_id } = await params;
        const { searchParams } = new URL(request.url);

        const { date, error } = parseReportDate(searchParams);
        if (error) {
            return NextResponse.json({ error }, { status: 400 });
        }

        const summary = await getReportSummary(school_id, date);
        return NextResponse.json(summary);
    } catch (error) {
        console.error("Report Summary Failed :", error);
        return NextResponse.json({ error: "Failed to generate report summary" }, { status: 500 });
    }
}
