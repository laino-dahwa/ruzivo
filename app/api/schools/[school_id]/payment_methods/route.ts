import { NextResponse } from "next/server";
import {getPaymentMethods} from "../../../../../repositories/school/read/getPaymentMethods"
import { createPaymentMethod } from "@/repositories/school/create/createPaymentMethod";
import { UpdatePaymentMethod } from "@/repositories/school/update/updatePaymentMethods";

import { deletePaymentMethod } from "../../../../../repositories/school/delete/deletePaymentMethod";
import { ReferenceInUseError } from "../../../../../repositories/school/referenceTable";

export const runtime = "nodejs";

type Params= {
    params: Promise<{school_id:string}>
}

export async function GET(request:Request,{ params }:Params) {
    const { school_id } = await params;
    const response = await getPaymentMethods(school_id)

    return NextResponse.json(response)
}



export async function POST(request:Request){
    try{
        const body = await request.json()

        if(!Array.isArray(body)){
            return NextResponse.json(
                {
                    error:"Request body must be an array of payment methods"
                },
                {
                    status: 400
                }
            )
        }

        const schools = await createPaymentMethod(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Payment methods Creation Failed :",error)

        return NextResponse.json(
            {
                 error:"Payment methods Creation Failure"
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
                    error:"Request body must be an array of payment methods"
                },
                {
                    status: 400
                }
            )
        }
       
     
        const schools = await UpdatePaymentMethod(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Payment method Update Failed :",error)

        return NextResponse.json(
            {
                 error:"Payment method Update Failure"
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
        const raw = searchParams.get("payment_method_id")

        if (!raw){
            return NextResponse.json({ error:"payment_method_id is required" }, { status:400 })
        }

        const deleted = await deletePaymentMethod(school_id, parseInt(raw, 10))

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
