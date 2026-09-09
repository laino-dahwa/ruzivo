import { NextResponse } from "next/server";
import {getAcademicYears} from "../../../../../repositories/school/read/getAcademicYears"
import { createAcademicYear } from "@/repositories/school/create/createAcademicYear";
import { UpdateAcademicYear } from "@/repositories/school/update/updateAcademicYears";

import { deleteAcademicYear } from "../../../../../repositories/school/delete/deleteAcademicYear";
import { ReferenceInUseError } from "../../../../../repositories/school/referenceTable";

export const runtime = "nodejs";

type Params= {
    params: Promise<{school_id:string}>
}

export async function GET(request:Request,{ params }:Params) {
    try{

        const { school_id } = await params;
        const response = await getAcademicYears(school_id)
        return NextResponse.json(response)

    }catch(error){

        console.error("Get academic years error: ",error)
        return NextResponse.json(
            {
                error:"Failed to retrieve academic years",
            },
            {
                status:500,
            }
        )
    }
  
}



export async function POST(request:Request){
    try{
        const body = await request.json()

        if(!Array.isArray(body)){
            return NextResponse.json(
                {
                    error:"Request body must be an array of academic years"
                },
                {
                    status: 400
                }
            )
        }

        const schools = await createAcademicYear(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Academic year Creation Failed :",error)

        return NextResponse.json(
            {
                 error:"Academic year Creation Failure"
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
                    error:"Request body must be an array of academic years"
                },
                {
                    status: 400
                }
            )
        }
       
     
        const schools = await UpdateAcademicYear(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Academic year Update Failed :",error)

        return NextResponse.json(
            {
                 error:"Academic year Update Failure"
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
        const raw = searchParams.get("academic_year_id")

        if (!raw){
            return NextResponse.json({ error:"academic_year_id is required" }, { status:400 })
        }

        const deleted = await deleteAcademicYear(school_id, parseInt(raw, 10))

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
