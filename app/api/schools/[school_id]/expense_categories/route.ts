import { NextResponse } from "next/server";
import {getExpenseCategories} from "../../../../../repositories/school/read/getExpenseCategories"
import { createExpenseCategory } from "@/repositories/school/create/createExpenseCategory";
import { UpdateExpenseCategory } from "@/repositories/school/update/updateExpenseCategories";
export const runtime = "nodejs";

type Params= {
    params: Promise<{school_id:string}>
}

export async function GET(request:Request,{ params }:Params) {
    const { school_id } = await params;
    const response = await getExpenseCategories(school_id)

    return NextResponse.json(response)
}



export async function POST(request:Request){
    try{
        const body = await request.json()

        if(!Array.isArray(body)){
            return NextResponse.json(
                {
                    error:"Request body must be an array of expense categories"
                },
                {
                    status: 400
                }
            )
        }

        const schools = await createExpenseCategory(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Expense category Creation Failed :",error)

        return NextResponse.json(
            {
                 error:"Expense category Creation Failure"
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
                    error:"Request body must be an array of Expense Categories"
                },
                {
                    status: 400
                }
            )
        }
       
     
        const schools = await UpdateExpenseCategory(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Expense category Update Failed :",error)

        return NextResponse.json(
            {
                 error:"Expense category Update Failure"
            },
            {
                status:500
            }
           
        )
    }
}



