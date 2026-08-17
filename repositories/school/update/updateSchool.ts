import { query } from "../../../lib/db";

type UpdateSchool = {
  school_id: string;
  school_name?: string;
  school_type?: string;
  school_address?: string;
  school_contact?: string;
  school_email?: string;
};

export async function updateSchool(schools: UpdateSchool[]) {
  if (schools.length === 0) {
    return [];
  }

  const values: unknown[] = [];

  const placeholders = schools.map((school, index) => {
    const offset = index * 6;

    values.push(
      school.school_id,
      school.school_name ?? null,
      school.school_type ?? null,
      school.school_address ?? null,
      school.school_contact ?? null,
      school.school_email ?? null
    );

    return `(
      $${offset + 1},
      $${offset + 2},
      $${offset + 3},
      $${offset + 4},
      $${offset + 5},
      $${offset + 6}
    )`;
  });

  const result = await query(
    `
    UPDATE schools AS s
    SET
      school_name = COALESCE(v.school_name, s.school_name),
      school_type = COALESCE(v.school_type, s.school_type),
      school_address = COALESCE(v.school_address, s.school_address),
      school_contact = COALESCE(v.school_contact, s.school_contact),
      school_email = COALESCE(v.school_email, s.school_email)

    FROM (
      VALUES
        ${placeholders.join(",")}
    ) AS v(
      school_id,
      school_name,
      school_type,
      school_address,
      school_contact,
      school_email
    )

    WHERE s.school_id = v.school_id

    RETURNING
      s.school_id,
      s.school_name,
      s.school_type,
      s.school_address,
      s.school_contact,
      s.school_email;
    `,
    values
  );

  return result.rows;
}