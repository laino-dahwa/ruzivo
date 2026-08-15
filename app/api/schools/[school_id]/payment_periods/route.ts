import { NextResponse } from "next/server";
import {getPaymentPeriods} from "../../../../../repositories/school/read/getPaymentPeriods"

export const runtime = "nodejs";

type Params= {
    params: Promise<{school_id:string}>
}

export async function GET(request:Request,{ params }:Params) {
    const { school_id } = await params;
    const response = await getPaymentPeriods(school_id)

    return NextResponse.json(response)
}