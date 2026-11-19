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
import { guardSchool, refuseOtherSchools, requireAuth } from "../../../../lib/auth/guard";
import type { Actor } from "../../../../lib/auth/session";
import { query } from "../../../../lib/db";

export const runtime = "nodejs";

type PaymentRecord = {
    learner_id: string;
    enrolment_id: number;
    payment_period_id: number;
    academic_year_id: number;
    payment_method_id: number;
    income_categories: { income_category_id: number }[];
};

/**
 * A payment names a learner, an enrolment, a period, a year, a method and
 * fees by id. Every one of them must belong to the learner's school, and
 * that school must be one the actor may act on (a cashier: their own).
 * Returns the refusal, or null when the request stays inside its school.
 */
async function schoolsOutsideScope(actor: Actor, records: PaymentRecord[]): Promise<NextResponse | null> {
    const learnerIds = [...new Set(records.map((r) => r.learner_id))]
    const learners = await query(`SELECT learner_id, school_id FROM learners WHERE learner_id = ANY($1::varchar[])`, [learnerIds])
    const schoolOf = new Map(learners.rows.map((row) => [String(row.learner_id), String(row.school_id).trim()]))

    // Unknown learners are left to the payment itself to reject.
    const refused = refuseOtherSchools(actor, [...schoolOf.values()])
    if (refused) return refused

    const lines = records.flatMap((r) => r.income_categories.map((line) => ({ ...r, income_category_id: line.income_category_id })))
    const mismatch = await query(
        `
        SELECT 1
        FROM unnest($1::varchar[], $2::bigint[], $3::bigint[], $4::bigint[], $5::bigint[], $6::bigint[])
          AS k(learner_id, enrolment_id, payment_period_id, academic_year_id, payment_method_id, income_category_id)
        JOIN learners l ON l.learner_id = k.learner_id
        WHERE NOT EXISTS (SELECT 1 FROM enrolments e WHERE e.enrolment_id = k.enrolment_id AND e.learner_id = k.learner_id)
           OR NOT EXISTS (SELECT 1 FROM payment_periods pp WHERE pp.payment_period_id = k.payment_period_id AND pp.school_id = l.school_id)
           OR NOT EXISTS (SELECT 1 FROM academic_years ay WHERE ay.academic_year_id = k.academic_year_id AND ay.school_id = l.school_id)
           OR NOT EXISTS (SELECT 1 FROM payment_methods pm WHERE pm.payment_method_id = k.payment_method_id AND pm.school_id = l.school_id)
           OR NOT EXISTS (SELECT 1 FROM income_categories ic WHERE ic.income_category_id = k.income_category_id AND ic.school_id = l.school_id)
        LIMIT 1
        `,
        [
            lines.map((l) => l.learner_id),
            lines.map((l) => l.enrolment_id),
            lines.map((l) => l.payment_period_id),
            lines.map((l) => l.academic_year_id),
            lines.map((l) => l.payment_method_id),
            lines.map((l) => l.income_category_id),
        ]
    )
    if (mismatch.rows.length > 0) {
        return NextResponse.json({ error: "The fee, period, year, method or enrolment does not belong to this learner's school." }, { status: 400 })
    }
    return null
}

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
        const  requested = getOptionalParam(searchParams,"school_id")
        if (!requested) {
            return NextResponse.json({ error: "school_id is required" }, { status: 400 })
        }
        const auth = await guardSchool(request, "payment.read", requested)
        if (!auth.ok) return auth.response
        const school_id = auth.school_id

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
        const auth = await requireAuth(request, "payment.create")
        if (!auth.ok) return auth.response

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

        const payments = records as unknown as Parameters<typeof createChargesWithPayments>[0]
        const outside = await schoolsOutsideScope(auth.actor, payments as unknown as PaymentRecord[])
        if (outside) return outside

        const schools = await createChargesWithPayments(payments)

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
        const auth = await requireAuth(request, "payment.delete")
        if (!auth.ok) return auth.response

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



