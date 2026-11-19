import { NextResponse } from "next/server";
import { requireAuth } from "../../../lib/auth/guard";
//import {getschool} from "../../../../repositories/school/read/getSchool"
import {createSchool} from "../../../repositories/school/create/createSchool"
import {deleteSchool} from "../../../repositories/school/delete/deteleSchool"



export const runtime = "nodejs";

export async function POST(request:Request){
    try{
        const auth = await requireAuth(request, "school.create");
        if (!auth.ok) return auth.response;

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

        const schools = await createSchool(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("School Creation Failed :",error)

        return NextResponse.json(
            {
                 error:"School Creation Failure"
            },
            {
                status:500
            }
           
        )
    }
}





export async function DELETE(request:Request){
    try{
        const auth = await requireAuth(request, "school.delete");
        if (!auth.ok) return auth.response;

        const {searchParams} = new URL(request.url)
       

        const school_id = searchParams.get("school_id")

        if (!school_id){
            return NextResponse.json(
                {
                    error:"school_id is required"
                    
                },
                {status:400}
            )
        }

        const deletedSchool = await deleteSchool(school_id)

        return NextResponse.json(
            deletedSchool,
            {
                status:201
            }
        )
    }catch(error){
        console.error("School Deletion Failed :",error)

        return NextResponse.json(
            {
                 error:"School Deletion Failure"
            },
            {
                status:500
            }
           
        )
    }
}

