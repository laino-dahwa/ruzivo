import { NextResponse } from "next/server";
import {getAcademicYears} from "../../../../../repositories/school/read/getAcademicYears"

export const runtime = "nodejs";

export async function GET(request,{ params }) {
    const { school_id } = await params;
    const response = await getAcademicYears(school_id)

    return NextResponse.json(response)
}