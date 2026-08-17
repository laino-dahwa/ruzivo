import { NextResponse } from "next/server";
import {getGender} from "../../../../../repositories/school/read/getGender"
import { createGender } from "@/repositories/school/create/createGenderCategory";
import { updateGender } from "@/repositories/school/update/updateGender";

export const runtime = "nodejs";

type Params= {
    params: Promise<{school_id:string}>
}

export async function GET(request:Request,{ params }:Params) {

    try{
        const { school_id } = await params;
        const response = await getGender(school_id)

        return NextResponse.json(response)
    }catch(error){
        console.error("Get gender error:",error)
        return NextResponse.json(
            {
                error:"Failed to retrieve gender categories",
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
                    error:"Request body must be an array of schools"
                },
                {
                    status: 400
                }
            )
        }

        const schools = await createGender(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Gender Creation Failed :",error)

        return NextResponse.json(
            {
                 error:"Gender Creation Failure"
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
                    error:"Request body must be an array of genders"
                },
                {
                    status: 400
                }
            )
        }
       
     
        const schools = await updateGender(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Gender Update Failed :",error)

        return NextResponse.json(
            {
                 error:"Gender Update Failure"
            },
            {
                status:500
            }
           
        )
    }
}



