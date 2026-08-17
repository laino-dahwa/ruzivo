import { query } from "../../../lib/db";

type income_category ={
    school_id :string,
    income_name :string,
    income_limit :string
  
}

export async function createIncomeCategory(income_categories:income_category[]){
    const values:unknown[] =[]
    const placeholders = 
    income_categories.map((income_category,index)=>{
        const offset = index*3;

        values.push(
            income_category.school_id,
            income_category.income_name,
            income_category.income_limit
            
        );
        return `
        (
        $${offset+1},$${offset+2},
        $${offset+3}
       
        )
        `;
    });

    const result = await query(
        `
        INSERT INTO income_categories(
         school_id,
         income_name,
         income_limit
       
        )
        VALUES${placeholders.join(", ")}
        RETURNING*
        `,
        values
    );
    return result.rows;
}