import { NextResponse } from "next/server";
import {getPayments, getPaymentsPage} from "../../../../repositories/payment/read/getPayments"
import { parseLimit } from "../../../../lib/pagination"
import {createChargesWithPayments, PaymentLimitError, DeletedLearnerError} from "../../../../repositories/payment/create/createNewPayment"
import {deleteCharge} from "../../../../repositories/payment/delete/delete_payment"
import { URLSearchParams } from "url";
import { normalizeToArray, validationErrorBody } from "../../../../lib/validation/bulk";
import { validatePayments } from "../../../../lib/validation/entities";
import { isPdfFormat } from "../../../../lib/reportRequest";
import { tablePdfResponse } from "../../../../lib/pdf/tablePdfResponse";
import { formatCurrency } from "../../../../lib/currency";

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

        // Required: payments are only ever listed for one school.
        const  school_id = getOptionalParam(searchParams,"school_id")
        if (!school_id) {
            return NextResponse.json({ error: "school_id is required" }, { status: 400 })
        }

        const filters = {
            learner_id: getOptionalParam(searchParams,"learner_id"),
            class_name: getOptionalParam(searchParams,"class_name"),
            gender_name: getOptionalParam(searchParams,"gender_name"),
            academic_year: getOptionalParam(searchParams,"academic_year"),
            income_name: getOptionalParam(searchParams,"income_name"),
            payment_period: getOptionalParam(searchParams,"payment_period"),
            method_name: getOptionalParam(searchParams,"method_name"),
        }

        // `?limit=` asks for one page plus totals (the Payments page); without
        // it, every matching row is returned (PDF export, older callers).
        const limit = parseLimit(searchParams)
        if (limit !== null && !isPdfFormat(searchParams)) {
            return NextResponse.json(
                await getPaymentsPage(school_id, filters, limit, getOptionalParam(searchParams,"cursor"))
            )
        }

        const response = await getPayments(school_id, filters)

        if (isPdfFormat(searchParams)) {
            const total = response.reduce((sum, row) => sum + Number(row.amount || 0), 0)
            return tablePdfResponse({
                title: "Payments",
                filenameStem: "payments",
                columns: [
                    { key: "learner", label: "Learner", width: 130 },
                    { key: "income", label: "Income", width: 100 },
                    { key: "period", label: "Period", width: 90 },
                    { key: "method", label: "Method", width: 85 },
                    { key: "amount", label: "Amount", width: 90, align: "right" },
                ],
                rows: response.map((row) => ({
                    learner: `${row.first_name} ${row.last_name}`,
                    income: row.income_name ?? "",
                    period: row.period_name ?? "",
                    method: row.method_name ?? "",
                    amount: formatCurrency(row.amount),
                })),
                totalLabel: "TOTAL PAYMENTS",
                totalValue: formatCurrency(total),
                emptyMessage: "No payments found.",
            })
        }

        return NextResponse.json(response)

    }catch(error){

        console.error("Get payments error: ",error)
        return NextResponse.json(
            {
                error:"Failed to retrieve payments",
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

        // Accepts a single payment object or an array of them.
        const records = normalizeToArray(body)

        if(!records){
            return NextResponse.json(
                {
                    error:"Request body must be a payment object or an array of payments"
                },
                {
                    status: 400
                }
            )
        }

        if(records.length === 0){
            return NextResponse.json([], { status: 201 })
        }

        const errors = validatePayments(records)

        if(errors.length > 0){
            return NextResponse.json(
                validationErrorBody(errors, "Payment"),
                { status: 400 }
            )
        }

        const schools = await createChargesWithPayments(records as unknown as Parameters<typeof createChargesWithPayments>[0])

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        // Exceeding a learner's fee limit is a rejected request, not a server
        // fault — answer with the same 400 shape as the other validation
        // failures so the client surfaces the reason to the user.
        if (error instanceof PaymentLimitError) {
            return NextResponse.json(
                {
                    error: error.violations[0].message,
                    details: error.violations,
                },
                { status: 400 }
            )
        }

        // An archived learner is a rejected request, not a server fault.
        if (error instanceof DeletedLearnerError) {
            return NextResponse.json(
                { error: error.message },
                { status: 400 }
            )
        }

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



