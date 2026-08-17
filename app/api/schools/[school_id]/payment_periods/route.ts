import { NextResponse } from "next/server";
import {getPaymentPeriods} from "../../../../../repositories/school/read/getPaymentPeriods"
import { createPaymentPeriod } from "@/repositories/school/create/createPaymentPeriod";
import { UpdatePaymentPeriod } from "@/repositories/school/update/updatePaymentPeriods";

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



