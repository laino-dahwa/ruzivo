import { NextResponse } from "next/server";
import {getExpense} from "../../../../../repositories/school/read/getExpense"

export const runtime = "nodejs";

type Params= {
    params: Promise<{school_id:string}>
}

export async function GET(request:Request,{ params }:Params) {
    const { school_id } = await params;
    const response = await getExpense(school_id)

    return NextResponse.json(response)
}