import { query } from "../../../lib/db";

type payment_method ={
    school_id :string
    method_name :string,
}

export async function createPaymentMethod(payment_methods:payment_method[]){
    const values:unknown[] =[]
    const placeholders = 
    payment_methods.map((payment_method,index)=>{
        const offset = index*6;

        values.push(
            payment_method.school_id,
            payment_method.method_name
           
        );
        return `
        (
        $${offset+1},$${offset+2}
        )
        `;
    });

    const result = await query(
        `
        INSERT INTO payment_methods(
         school_id,
         method_name,
        )
        VALUES${placeholders.join(", ")}
        RETURNING*
        `,
        values
    );
    return result.rows;
}