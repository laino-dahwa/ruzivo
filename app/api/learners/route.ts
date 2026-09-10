import { NextResponse } from "next/server";
import {getLearners} from "../../../repositories/learner/read/getLearners"
import { URLSearchParams } from "url";
import { createLearners } from "@/repositories/learner/create/addLearner";
import { LearnerUpdateError, updateLearners } from "@/repositories/learner/update/updateLearner";
import { deleteLearner } from "@/repositories/learner/delete/deleteLearner";
import { normalizeToArray, validationErrorBody } from "../../../lib/validation/bulk";
import { validateLearners, validateLearnerUpdates } from "../../../lib/validation/entities";
import { isPdfFormat } from "../../../lib/reportRequest";
import { tablePdfResponse } from "../../../lib/pdf/tablePdfResponse";

export const runtime = "nodejs";

function getOptionalParam(searchParams:URLSearchParams,name:string):string|null{
    const value = searchParams.get(name);
    if(!value || value === "null"){
        return null
    }
    return value
}

export async function GET(request:Request) {
    try{
        
        const {searchParams} = new URL(request.url)

        const  learner_id  =getOptionalParam(searchParams,"learner_id");
        const  class_name = getOptionalParam(searchParams,"class_name")
        const  gender_name = getOptionalParam(searchParams,"gender_name")
        const  academic_year = getOptionalParam(searchParams,"academic_year")
        const response = await getLearners(learner_id,class_name,gender_name,academic_year)

        // Exports exactly the rows the filters above produced, matching how
        // the Reports section exports what the user is currently viewing.
        if (isPdfFormat(searchParams)) {
            return tablePdfResponse({
                title: "Learners List",
                filenameStem: "learners",
                columns: [
                    { key: "learner_id", label: "Learner ID", width: 80 },
                    { key: "name", label: "Name", width: 150 },
                    { key: "gender", label: "Gender", width: 80 },
                    { key: "class", label: "Class", width: 95 },
                    { key: "year", label: "Year", width: 90 },
                ],
                rows: response.map((row) => ({
                    learner_id: row.learner_id,
                    name: `${row.first_name} ${row.last_name}`,
                    gender: row.gender_name ?? "",
                    class: row.class_name ?? "",
                    year: row.curent_year ?? "",
                })),
                emptyMessage: "No learners found.",
            })
        }

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

        // Accepts a single learner object or an array of them.
        const records = normalizeToArray(body)

        if(!records){
            return NextResponse.json(
                {
                    error:"Request body must be a learner object or an array of learners"
                },
                {
                    status: 400
                }
            )
        }

        if(records.length === 0){
            return NextResponse.json([], { status: 201 })
        }

        const errors = validateLearners(records)

        if(errors.length > 0){
            return NextResponse.json(
                validationErrorBody(errors, "Learner"),
                { status: 400 }
            )
        }

        const schools = await createLearners(records as unknown as Parameters<typeof createLearners>[0])

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

        // Accepts a single learner object or an array of them, matching POST.
        const records = normalizeToArray(body)

        if(!records){
            return NextResponse.json(
                {
                    error:"Request body must be a learner object or an array of learners"
                },
                {
                    status: 400
                }
            )
        }

        if(records.length === 0){
            return NextResponse.json({ learners: [], enrolments: [] })
        }

        const errors = validateLearnerUpdates(records)

        if(errors.length > 0){
            return NextResponse.json(
                validationErrorBody(errors, "Learner"),
                { status: 400 }
            )
        }

        const updated = await updateLearners(records as unknown as Parameters<typeof updateLearners>[0])

        return NextResponse.json(updated)

    }catch(error){
        // A refused edit (unknown learner, duplicate enrolment year, missing
        // reference row) is the caller's to fix, so it carries its reason
        // rather than being flattened into a generic failure.
        if(error instanceof LearnerUpdateError){
            return NextResponse.json(
                { error: error.message },
                { status: 409 }
            )
        }

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



export async function DELETE(request:Request){
    try{
        const {searchParams} = new URL(request.url)

        const learner_id = searchParams.get("learner_id")

        if (!learner_id){
            return NextResponse.json(
                {
                    error:"learner_id is required"
                },
                {status:400}
            )
        }

        const deletedLearner = await deleteLearner(learner_id)

        return NextResponse.json(
            deletedLearner,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Learner Deletion Failed :",error)

        return NextResponse.json(
            {
                 error:"Learner Deletion Failure"
            },
            {
                status:500
            }
        )
    }
}

