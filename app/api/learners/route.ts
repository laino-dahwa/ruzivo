import { NextResponse } from "next/server";
import {getLearners} from "../../../repositories/learner/read/getLearners"
import { URLSearchParams } from "url";

export const runtime = "nodejs";

type Params= {
    params: Promise<{learner_id:string|null}>
}

function getOptionalParam(searchParams:URLSearchParams,name:string):string|null{
    const value = searchParams.get(name);
    if(!value || value === "null"){
        return null
    }
    return value
}

export async function GET(request:Request,{ params }:Params) {
    try{
        
        const {searchParams} = new URL(request.url)

        const  learner_id  =getOptionalParam(searchParams,"learner_id");
        const  class_name = getOptionalParam(searchParams,"class_name")
        const  gender_name = getOptionalParam(searchParams,"gender_name")
        const  academic_year = getOptionalParam(searchParams,"academic_year")
        const response = await getLearners(learner_id,class_name,gender_name,academic_year)
        return NextResponse.json(response)

    }catch(error){

        console.error("Get learners error: ",error)
        return NextResponse.json(
            {
                error:"Failed to retrieve learners",
            },
            {
                status:500,
            }
        )
    }
  
}