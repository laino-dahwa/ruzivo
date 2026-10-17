import { NextResponse } from "next/server";
import {getIncomeCategories} from "../../../../../repositories/school/read/getInomeCategories"
import { createIncomeCategory, IncomeCategoryInputError } from "@/repositories/school/create/createIncomeCategory";
import { UpdateIncomeCategory } from "@/repositories/school/update/updateIncomeCategories";

import { deleteIncomeCategory } from "../../../../../repositories/school/delete/deleteIncomeCategory";
import { ReferenceInUseError } from "../../../../../repositories/school/referenceTable";

export const runtime = "nodejs";

type Params= {
    params: Promise<{school_id:string}>
}

export async function GET(request:Request,{ params }:Params) {
    const { school_id } = await params;
    const response = await getIncomeCategories(school_id)

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

        const schools = await createIncomeCategory(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        if (error instanceof IncomeCategoryInputError) {
            return NextResponse.json({ error: error.message }, { status: 400 })
        }

        console.error("Income category Creation Failed :",error)

        return NextResponse.json(
            {
                 error:"Income category Creation Failure"
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
                    error:"Request body must be an array of income category"
                },
                {
                    status: 400
                }
            )
        }
       
     
        const schools = await UpdateIncomeCategory(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        if (error instanceof IncomeCategoryInputError) {
            return NextResponse.json({ error: error.message }, { status: 400 })
        }

        console.error("Income category Update Failed :",error)

        return NextResponse.json(
            {
                 error:"Income category Update Failure"
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
        const raw = searchParams.get("income_category_id")

        if (!raw){
            return NextResponse.json({ error:"income_category_id is required" }, { status:400 })
        }

        const deleted = await deleteIncomeCategory(school_id, parseInt(raw, 10))

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
