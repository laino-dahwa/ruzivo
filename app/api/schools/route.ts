import { NextResponse } from "next/server";
//import {getschool} from "../../../../repositories/school/read/getSchool"
import {createSchool} from "../../../repositories/school/create/createSchool"


export const runtime = "nodejs";

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

