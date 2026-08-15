import { query } from "../../../lib/db";

type school ={
    school_id :string
    school_name :string,
    school_type :string,
    school_address :string,
    school_contact :string,
    school_email :string,
}

export async function createSchool(schools:school[]){
    const values:unknown[] =[]
    const placeholders = 
    schools.map((school,index)=>{
        const offset = index*6;

        values.push(
            school.school_id,
            school.school_name,
            school.school_type,
            school.school_address,
            school.school_address,
            school.school_email
        );
        return `
        (
        $${offset+1},$${offset+2},
        $${offset+3},$${offset+4},
        $${offset+5},$${offset+6}
        )
        `;
    });

    const result = await query(
        `
        INSERT INTO schools(
         school_id,
         school_name,
         school_type,
         school_address,
         school_contact,
         school_email
        )
        VALUES${placeholders.join(", ")}
        RETURNING*
        `,
        values
    );
    return result.rows;
}