import { query } from "../../../lib/db";

type UpdateAcademicYears = {
  school_id :string,
  academic_year_name? :string,
  start_date?:string,
  end_date?:string
};

export async function UpdateAcademicYear(academic_years: UpdateAcademicYears[]) {
  if (academic_years.length === 0) {
    return [];
  }

  const values: unknown[] = [];

  const placeholders = academic_years.map((academic_year, index) => {
    const offset = index * 4;

    values.push(
      academic_year.school_id,
      academic_year.academic_year_name ?? null,
      academic_year.start_date?? null,
      academic_year.end_date?? null,
     
    );

    return `(
      $${offset + 1},
      $${offset + 2},
      $${offset + 3},
      $${offset + 4}
    
    )`;
  });

  const result = await query(
    `
    UPDATE academic_years AS s
    SET
      academic_year_name = COALESCE(v.academic_year_name, s.academic_year_name),
      start_date = COALESCE(v.start_date, s.start_date),
      end_date= COALESCE(v.end_date, s.end_date),
      

    FROM (
      VALUES
        ${placeholders.join(",")}
    ) AS v(
      school_id,
      academic_year_name,
      start_date,
      end_date,
    )

    WHERE s.school_id = v.school_id

    RETURNING
      s.school_id,
      s.academic_year_name,
      s.start_date,
      s.end_date,
    
    `,
    values
  );

  return result.rows;
}