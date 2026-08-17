import { NextResponse } from "next/server";
import {getExpense} from "../../../../../repositories/school/read/getExpense"
import { createExpense } from "@/repositories/school/create/createExpense";


export const runtime = "nodejs";

type Params= {
    params: Promise<{school_id:string}>
}

export async function GET(request:Request,{ params }:Params) {
    const { school_id } = await params;
    const response = await getExpense(school_id)

    return NextResponse.json(response)
}



export async function POST(request:Request){
    try{
        const body = await request.json()

        if(!Array.isArray(body)){
            return NextResponse.json(
                {
                    error:"Request body must be an array of schools"
                },
                {
                    status: 400
                }
            )
        }

        const schools = await createExpense(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Expense Creation Failed :",error)

        return NextResponse.json(
            {
                 error:"Expense Creation Failure"
            },
            {
                status:500
            }
           
        )
    }
}


