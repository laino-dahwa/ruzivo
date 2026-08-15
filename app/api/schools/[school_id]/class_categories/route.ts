import { NextResponse } from "next/server";
import {getClassCategories} from "../../../../../repositories/school/read/getClassCategories"

export const runtime = "nodejs";

type Params= {
    params: Promise<{school_id:string}>
}

export async function GET(request:Request,{ params }:Params) {
    const { school_id } = await params;
    const response = await getClassCategories(school_id)

    return NextResponse.json(response)
}