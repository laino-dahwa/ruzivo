import { query } from "../../../lib/db";

type payment_period ={
    school_id :string
    period_name :string,
 
}

export async function createPaymentPeriod(payment_periods:payment_period[]){
    const values:unknown[] =[]
    const placeholders = 
    payment_periods.map((payment_period,index)=>{
        const offset = index*2;

        values.push(
            payment_period.school_id,
            payment_period.period_name
            
        );
        return `
        (
        $${offset+1},$${offset+2}
        )
        `;
    });

    const result = await query(
        `
        INSERT INTO payment_periods(
         school_id,
         period_name
        )
        VALUES${placeholders.join(", ")}
        RETURNING*
        `,
        values
    );
    return result.rows;
}