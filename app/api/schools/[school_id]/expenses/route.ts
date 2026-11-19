import { NextResponse } from "next/server";
import { guardSchool, refuseOtherSchools, requireAuth } from "../../../../../lib/auth/guard";
import { query } from "../../../../../lib/db";
import {getExpense, getExpensePage} from "../../../../../repositories/school/read/getExpense"
import { parseLimit } from "../../../../../lib/pagination"
import { createExpense } from "@/repositories/school/create/createExpense";
import { deleteExpense } from "@/repositories/school/delete/deleteExpense";
import { normalizeToArray, validationErrorBody } from "../../../../../lib/validation/bulk";
import { validateExpenses } from "../../../../../lib/validation/entities";
import { isPdfFormat } from "../../../../../lib/reportRequest";
import { tablePdfResponse } from "../../../../../lib/pdf/tablePdfResponse";
import { formatCurrency } from "../../../../../lib/currency";
import { getExpenseCategories } from "../../../../../repositories/school/read/getExpenseCategories";
import { getschool } from "../../../../../repositories/school/read/getSchool";


export const runtime = "nodejs";

type Params= {
    params: Promise<{school_id:string}>
}

export async function GET(request:Request,{ params }:Params) {
    const { school_id: requested } = await params;
    const auth = await guardSchool(request, "expense.read", requested);
    if (!auth.ok) return auth.response;
    const school_id = auth.school_id;
    const { searchParams } = new URL(request.url)

    // `?limit=` asks for one page plus totals (the Expenses page); without
    // it, every expense is returned (PDF export, older callers).
    const limit = parseLimit(searchParams)
    if (limit !== null && !isPdfFormat(searchParams)) {
        const cursor = searchParams.get("cursor")
        return NextResponse.json(await getExpensePage(school_id, limit, cursor))
    }

    const response = await getExpense(school_id)

    if (isPdfFormat(searchParams)) {
        // The table shows category names, not ids, so the export resolves
        // them the same way the Expenses page does.
        const categories = await getExpenseCategories(school_id)
        const categoryName = (id: number) =>
            categories.find((category) => Number(category.expense_category_id) === Number(id))?.expense_name ?? "—"

        const schools = await getschool(school_id)
        const total = response.reduce((sum, row) => sum + Number(row.amount || 0), 0)

        return tablePdfResponse({
            title: "Expenses",
            filenameStem: "expenses",
            schoolName: schools[0]?.school_name ?? school_id,
            columns: [
                { key: "date", label: "Date", width: 90 },
                { key: "category", label: "Category", width: 120 },
                { key: "description", label: "Description", width: 200 },
                { key: "amount", label: "Amount", width: 95, align: "right" },
            ],
            rows: response.map((row) => ({
                date: row.expense_date ? String(row.expense_date).slice(0, 10).split("-").reverse().join("/") : "",
                category: categoryName(row.expense_category_id),
                description: row.description ?? "",
                amount: formatCurrency(row.amount),
            })),
            totalLabel: "TOTAL EXPENSES",
            totalValue: formatCurrency(total),
            emptyMessage: "No expenses found.",
        })
    }

    return NextResponse.json(response)
}



export async function POST(request:Request){
    try{
        const auth = await requireAuth(request, "expense.create");
        if (!auth.ok) return auth.response;

        const body = await request.json()

        // Accepts a single expense object or an array of them.
        const records = normalizeToArray(body)

        if(!records){
            return NextResponse.json(
                {
                    error:"Request body must be an expense object or an array of expenses"
                },
                {
                    status: 400
                }
            )
        }

        if(records.length === 0){
            return NextResponse.json([], { status: 201 })
        }

        const errors = validateExpenses(records)

        if(errors.length > 0){
            return NextResponse.json(
                validationErrorBody(errors, "Expense"),
                { status: 400 }
            )
        }

        // An expense reaches its school through its category; a cashier may
        // only record against their own school's categories.
        const categoryIds = records.map((record) => Number((record as Record<string, unknown>).expense_category_id))
        const categories = await query(`SELECT school_id FROM expense_categories WHERE expense_category_id = ANY($1::bigint[])`, [categoryIds])
        const refused = refuseOtherSchools(auth.actor, categories.rows.map((row) => String(row.school_id)))
        if (refused) return refused

        const schools = await createExpense(records as unknown as Parameters<typeof createExpense>[0])

        return NextResponse.json(
            schools,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Expense Creation Failed :",error)

        return NextResponse.json(
            {
                 error:"Expense Creation Failure"
            },
            {
                status:500
            }

        )
    }
}



export async function DELETE(request:Request,{ params }:Params){
    try{
        const { school_id: requested } = await params;
        const auth = await guardSchool(request, "expense.delete", requested);
        if (!auth.ok) return auth.response;
        const school_id = auth.school_id;
        const {searchParams} = new URL(request.url)

        const expense = searchParams.get("expense_id")

        if (!expense){
            return NextResponse.json(
                {
                    error:"expense_id is required"
                },
                {status:400}
            )
        }

        const expense_id = parseInt(expense, 10)

        const deletedExpense = await deleteExpense(school_id, expense_id)

        return NextResponse.json(
            deletedExpense,
            {
                status:201
            }
        )
    }catch(error){
        console.error("Expense Deletion Failed :",error)

        return NextResponse.json(
            {
                 error:"Expense Deletion Failure"
            },
            {
                status:500
            }

        )
    }
}


