import { query } from "../../../lib/db";

type expense ={
    expense_category_id:string,
    amount:number,
    expense_date:Date,
    description:string,

}

export async function createExpense(expenses:expense[]){
    const values:unknown[] =[]
    const placeholders = 
    expenses.map((expense,index)=>{
        const offset = index*4;

        values.push(
            expense.expense_category_id,
            expense.amount,
            expense.expense_date,
            expense.description
           
        );
        return `
        (
        $${offset+1},$${offset+2},
        $${offset+3},$${offset+4}
        )
        `;
    });

    const result = await query(
        `
        INSERT INTO expenses(
            expense_category_id,
            amount,
            expense_date,
            description
         
        )
        VALUES${placeholders.join(", ")}
        RETURNING*
        `,
        values
    );
    return result.rows;
}