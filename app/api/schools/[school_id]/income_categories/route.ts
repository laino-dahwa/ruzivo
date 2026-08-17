import { NextResponse } from "next/server";
import {getIncomeCategories} from "../../../../../repositories/school/read/getInomeCategories"
import { createIncomeCategory } from "@/repositories/school/create/createIncomeCategory";
import { UpdateIncomeCategory } from "@/repositories/school/update/updateIncomeCategories";

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



