import { query } from "../../../lib/db";

type class_category ={
    school_id :string
    class_name :string,
    
}

export async function createClassCategory(class_categories:class_category[]){
    const values:unknown[] =[]
    const placeholders = 
    class_categories.map((class_category,index)=>{
        const offset = index*6;

        values.push(
            class_category.school_id,
            class_category.class_name,
            
        );
        return `
        (
        $${offset+1},$${offset+2}
        )
        `;
    });

    const result = await query(
        `
        INSERT INTO class_categories(
         school_id,
         class_name
        )
        VALUES${placeholders.join(", ")}
        RETURNING*
        `,
        values
    );
    return result.rows;
}