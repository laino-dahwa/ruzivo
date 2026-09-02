import { NextResponse } from "next/server";
import {getPayments} from "../../../../repositories/payment/read/getPayments"
import {createChargesWithPayments} from "../../../../repositories/payment/create/createNewPayment"
import {deleteCharge} from "../../../../repositories/payment/delete/delete_payment"
import { URLSearchParams } from "url";

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
         const  income_name = getOptionalParam(searchParams,"income_name")
        const  payment_period = getOptionalParam(searchParams,"payment_period")
        const  method_name = getOptionalParam(searchParams,"method_name")
        const response = await getPayments(learner_id,class_name,gender_name,academic_year,income_name,payment_period,method_name)
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

        if(!body){
            return NextResponse.json(
                {
                    error:"Request body must be an payment object"
                },
                {
                    status: 400
                }
            )
        }

        const schools = await createChargesWithPayments(body)

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Payment Creation Failed :",error)

        return NextResponse.json(
            {
                 error:"Payment Creation Failure"
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
       

        const charge = searchParams.get("charge_id")
      

        if (!charge){
            return NextResponse.json(
                {
                    error:"Charge_id is required"
                    
                },
                {status:400}
            )
        }

        const charge_id = parseInt(charge, 10)

        const deletedSchool = await deleteCharge(charge_id)

        return NextResponse.json(
            deletedSchool,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Payment Deletion Failed :",error)

        return NextResponse.json(
            {
                 error:"Payment Deletion Failure"
            },
            {
                status:500
            }
           
        )
    }
}



