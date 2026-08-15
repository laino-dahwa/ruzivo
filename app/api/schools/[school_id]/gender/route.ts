import { NextResponse } from "next/server";
import {getGender} from "../../../../../repositories/school/read/getGender"

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
                error:"Failed to retrieve class categories",
            },
            {
                status:500,
            }
        )

    }
}