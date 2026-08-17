import { query } from "../../../lib/db";

type expense_category ={
    school_id :string
    expense_name :string,
    
}

export async function createExpenseCategory(expense_categories:expense_category[]){
    const values:unknown[] =[]
    const placeholders = 
    expense_categories.map((expense_category,index)=>{
        const offset = index*2;

        values.push(
            expense_category.school_id,
            expense_category.expense_name
        );
        return `
        (
        $${offset+1},$${offset+2}
        )
        `;
    });

    const result = await query(
        `
        INSERT INTO expense_categories(
         school_id,
         expense_name
        )
        VALUES${placeholders.join(", ")}
        RETURNING*
        `,
        values
    );
    return result.rows;
}