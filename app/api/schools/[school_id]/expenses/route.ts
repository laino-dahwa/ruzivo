import { NextResponse } from "next/server";
import {getExpense} from "../../../../../repositories/school/read/getExpense"
import { createExpense } from "@/repositories/school/create/createExpense";
import { deleteExpense } from "@/repositories/school/delete/deleteExpense";


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
                    error:"Request body must be an array of expenses"
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



export async function DELETE(request:Request,{ params }:Params){
    try{
        const { school_id } = await params;
        const {searchParams} = new URL(request.url)

        const expense = searchParams.get("expense_id")

        if (!expense){
            return NextResponse.json(
                {
                    error:"expense_id is required"
                },
                {status:400}
            )
        }

        const expense_id = parseInt(expense, 10)

        const deletedExpense = await deleteExpense(school_id, expense_id)

        return NextResponse.json(
            deletedExpense,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Expense Deletion Failed :",error)

        return NextResponse.json(
            {
                 error:"Expense Deletion Failure"
            },
            {
                status:500
            }

        )
    }
}


