import { query } from "../../../lib/db";

type gender ={
    school_id :string
    gender_name :string,
}

export async function createGender(genders:gender[]){
    const values:unknown[] =[]
    const placeholders = 
    genders.map((gender,index)=>{
        const offset = index*2;

        values.push(
            gender.school_id,
            gender.gender_name
        );
        return `
        (
        $${offset+1},$${offset+2}
        
        )
        `;
    });

    const result = await query(
        `
        INSERT INTO genders(
         school_id,
         gender_name
        )
        VALUES${placeholders.join(", ")}
        RETURNING*
        `,
        values
    );
    return result.rows;
}