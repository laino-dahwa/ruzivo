import { NextResponse } from "next/server";
import {getAcademicYears} from "../../../../../repositories/school/read/getAcademicYears"

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