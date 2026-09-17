import { NextResponse } from "next/server";
import {getBalances} from "../../../../repositories/payment/read/getBalances"
import { URLSearchParams } from "url";
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

        const  school_id = getOptionalParam(searchParams,"school_id")
        if (!school_id) {
            return NextResponse.json({ error: "school_id is required" }, { status: 400 })
        }

        const  learner_id  =getOptionalParam(searchParams,"learner_id");
        const  class_name = getOptionalParam(searchParams,"class_name")
        const  gender_name = getOptionalParam(searchParams,"gender_name")
        const  academic_year = getOptionalParam(searchParams,"academic_year")
         const  income_name = getOptionalParam(searchParams,"income_name")
        const  payment_period = getOptionalParam(searchParams,"payment_period")
        // Settled rows are dropped only when asked for, so the JSON the
        // Record Payment form reads still carries every fee.
        const only_outstanding = getOptionalParam(searchParams,"only_outstanding") === "true"
        const response = await getBalances(school_id,learner_id,class_name,gender_name,academic_year,income_name,payment_period,only_outstanding)

        if (isPdfFormat(searchParams)) {
            const total = response.reduce((sum, row) => sum + Number(row.balance || 0), 0)
            return tablePdfResponse({
                title: "Outstanding Balances",
                filenameStem: "outstanding-balances",
                columns: [
                    { key: "learner", label: "Learner", width: 125 },
                    { key: "income", label: "Income", width: 100 },
                    { key: "period", label: "Period", width: 75 },
                    { key: "charged", label: "Charged", width: 80, align: "right" },
                    { key: "paid", label: "Paid", width: 75, align: "right" },
                    { key: "balance", label: "Balance", width: 85, align: "right" },
                ],
                rows: response.map((row) => ({
                    learner: `${row.first_name} ${row.last_name}`,
                    income: row.income_name ?? "",
                    period: row.period_name ?? "",
                    charged: formatCurrency(row.charged),
                    paid: formatCurrency(row.paid),
                    balance: formatCurrency(row.balance),
                })),
                totalLabel: "TOTAL OUTSTANDING",
                totalValue: formatCurrency(total),
                emptyMessage: "No outstanding balances found.",
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