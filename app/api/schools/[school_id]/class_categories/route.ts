import { NextResponse } from "next/server";
import {getClassCategories} from "../../../../../repositories/school/read/getClassCategories"
import { createClassCategory } from "@/repositories/school/create/createClassCategory";
import { UpdateClassCategory } from "@/repositories/school/update/updateClassCategories";

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



