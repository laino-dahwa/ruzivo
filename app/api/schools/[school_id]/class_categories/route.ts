import { NextResponse } from "next/server";
import {getClassCategories} from "../../../../../repositories/school/read/getClassCategories"
import { createClassCategory } from "@/repositories/school/create/createClassCategory";
import { UpdateClassCategory } from "@/repositories/school/update/updateClassCategories";

import { deleteClassCategory } from "../../../../../repositories/school/delete/deleteClassCategory";
import { ReferenceInUseError } from "../../../../../repositories/school/referenceTable";

export const runtime = "nodejs";

type Params= {
    params: Promise<{school_id:string}>
}

export async function GET(request:Request,{ params }:Params) {
    const { school_id } = await params;
    const response = await getClassCategories(school_id)

    return NextResponse.json(response)
}



export async function POST(request:Request){
    try{
        const body = await request.json()

        if(!Array.isArray(body)){
            return NextResponse.json(
                {
                    error:"Request body must be an array of class categories"
                },
                {
                    status: 400
                }
            )
        }

        const schools = await createClassCategory(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Class Category Creation Failed :",error)

        return NextResponse.json(
            {
                 error:"Class Category Creation Failure"
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
                    error:"Request body must be an array of class categories"
                },
                {
                    status: 400
                }
            )
        }
       
     
        const schools = await UpdateClassCategory(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Class category Update Failed :",error)

        return NextResponse.json(
            {
                 error:"class category Update Failure"
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
        const raw = searchParams.get("class_category_id")

        if (!raw){
            return NextResponse.json({ error:"class_category_id is required" }, { status:400 })
        }

        const deleted = await deleteClassCategory(school_id, parseInt(raw, 10))

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
