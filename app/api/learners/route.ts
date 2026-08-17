import { NextResponse } from "next/server";
import {getLearners} from "../../../repositories/learner/read/getLearners"
import { URLSearchParams } from "url";
import { CreateLearnerInput, createLearners } from "@/repositories/learner/create/addLearner";
import { updateLearners } from "@/repositories/learner/update/updateLearner";

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



export async function POST(request:Request){
    try{
        const body = await request.json()

        if(!Array.isArray(body)){
            return NextResponse.json(
                {
                    error:"Request body must be an array of learners"
                },
                {
                    status: 400
                }
            )
        }

        const schools = await createLearners(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Learner Creation Failed :",error)

        return NextResponse.json(
            {
                 error:"Learner Creation Failure"
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
                    error:"Request body must be an array of learners"
                },
                {
                    status: 400
                }
            )
        }
       
     
        const schools = await updateLearners(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Learner Update Failed :",error)

        return NextResponse.json(
            {
                 error:"Learner Update Failure"
            },
            {
                status:500
            }
           
        )
    }
}



