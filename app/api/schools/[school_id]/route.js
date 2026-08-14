import { NextResponse } from "next/server";
import {getschool} from "../../../../repositories/school/read/get_school"

export const runtime = "nodejs";

export async function GET(request,{ params }) {
    const { school_id } = await params;
    const response = await getschool(school_id)


   
    return NextResponse.json(response)
}
