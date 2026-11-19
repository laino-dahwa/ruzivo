import { NextResponse } from "next/server";
import { guardSchool } from "../../../../../lib/auth/guard";
import { getSchoolExportData } from "@/repositories/school/export/getSchoolExportData";
import { buildWorkbook } from "../../../../../lib/excel/workbook";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ school_id: string }>;
};

/** Every table the app holds for this school, as one .xlsx with one sheet per table. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { school_id: requested } = await params;
    const auth = await guardSchool(request, "school.manage", requested);
    if (!auth.ok) return auth.response;
    const school_id = auth.school_id;
    const sheets = await getSchoolExportData(school_id);
    const workbook = await buildWorkbook(sheets);

    return new NextResponse(new Uint8Array(workbook), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${school_id.trim()}-export.xlsx"`,
      },
    });
  } catch (error) {
    console.error("School Export Failed :", error);
    return NextResponse.json({ error: "Failed to export school data" }, { status: 500 });
  }
}
