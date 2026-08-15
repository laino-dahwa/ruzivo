import { query } from "../../../lib/db";

type academic_year ={
    school_id :string,
    academic_year_name :string,
    start_date :string,
    end_data :string
}

export async function createAcademicYear(academic_years:academic_year[]){
    const values:unknown[] =[]
    const placeholders = 
    academic_years.map((academic_year,index)=>{
        const offset = index*6;

        values.push(
            academic_year.school_id,
            academic_year.academic_year_name,
            academic_year.start_date,
            academic_year.end_data,
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
        INSERT INTO academic_years(
         school_id,
         academic_year_name,
         start_date,
         end_data
        )
        VALUES${placeholders.join(", ")}
        RETURNING*
        `,
        values
    );
    return result.rows;
}