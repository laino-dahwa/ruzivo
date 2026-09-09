import { NextResponse } from "next/server";
import {getPaymentPeriods} from "../../../../../repositories/school/read/getPaymentPeriods"
import { createPaymentPeriod } from "@/repositories/school/create/createPaymentPeriod";
import { UpdatePaymentPeriod } from "@/repositories/school/update/updatePaymentPeriods";

import { deletePaymentPeriod } from "../../../../../repositories/school/delete/deletePaymentPeriod";
import { ReferenceInUseError } from "../../../../../repositories/school/referenceTable";

export const runtime = "nodejs";

type Params= {
    params: Promise<{school_id:string}>
}

export async function GET(request:Request,{ params }:Params) {
    const { school_id } = await params;
    const response = await getPaymentPeriods(school_id)

    return NextResponse.json(response)
}




export async function POST(request:Request){
    try{
        const body = await request.json()

        if(!Array.isArray(body)){
            return NextResponse.json(
                {
                    error:"Request body must be an array of payment periods"
                },
                {
                    status: 400
                }
            )
        }

        const schools = await createPaymentPeriod(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Payment periods Creation Failed :",error)

        return NextResponse.json(
            {
                 error:"Payment periods Creation Failure"
            },
            {
                status:500
            }
           
        )
    }
}



export async function PATCH(request:Request){
    try{
        const body = await request.json()
       
         if(!Array.isArray(body)){
            return NextResponse.json(
                {
                    error:"Request body must be an array of payment period"
                },
                {
                    status: 400
                }
            )
        }
       
     
        const schools = await UpdatePaymentPeriod(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Payment period Update Failed :",error)

        return NextResponse.json(
            {
                 error:"Payment period Update Failure"
            },
            {
                status:500
            }
           
        )
    }
}

export async function DELETE(request:Request,{ params }:Params){
    try{
        const { school_id } = await params;
        const {searchParams} = new URL(request.url)
        const raw = searchParams.get("payment_period_id")

        if (!raw){
            return NextResponse.json({ error:"payment_period_id is required" }, { status:400 })
        }

        const deleted = await deletePaymentPeriod(school_id, parseInt(raw, 10))

        return NextResponse.json(deleted, { status:200 })
    }catch(error){
        // Still referenced by real records — a rejected request, not a fault.
        if (error instanceof ReferenceInUseError) {
            return NextResponse.json({ error: error.message }, { status:409 })
        }

        console.error("Delete failed :",error)
        return NextResponse.json({ error:"Delete failed" }, { status:500 })
    }
}
