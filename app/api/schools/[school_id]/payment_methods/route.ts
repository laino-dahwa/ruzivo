import { NextResponse } from "next/server";
import {getPaymentMethods} from "../../../../../repositories/school/read/getPaymentMethods"

export const runtime = "nodejs";

type Params= {
    params: Promise<{school_id:string}>
}

export async function GET(request:Request,{ params }:Params) {
    const { school_id } = await params;
    const response = await getPaymentMethods(school_id)

    return NextResponse.json(response)
}