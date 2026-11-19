import { NextResponse } from "next/server";
import { guardSchool, requireAuth } from "../../../../lib/auth/guard";
import {getschool} from "../../../../repositories/school/read/getSchool"
import {createSchool} from "../../../../repositories/school/create/createSchool"
import {updateSchool} from "../../../../repositories/school/update/updateSchool"


export const runtime = "nodejs";

type Params={
    params:Promise<{school_id:string}>;
}

export async function GET(request:Request,{ params }:Params) {

    const { school_id: requested } = await params;

    const auth = await guardSchool(request, "reference.read", requested);

    if (!auth.ok) return auth.response;

    const school_id = auth.school_id;
    const response = await getschool(school_id)

    return NextResponse.json(response)
}


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



export async function PATCH(request:Request){
    try{
        const auth = await requireAuth(request, "school.manage");
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
       
     
        const schools = await updateSchool(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("School Update Failed :",error)

        return NextResponse.json(
            {
                 error:"School Update Failure"
            },
            {
                status:500
            }
           
        )
    }
}



