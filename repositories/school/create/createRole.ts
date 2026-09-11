import { query } from "../../../lib/db";

type role = {
    school_id: string
    role_name: string,
}

export async function createRole(roles: role[]) {
    const values: unknown[] = []
    const placeholders =
        roles.map((role, index) => {
            const offset = index * 2;

            values.push(
                role.school_id,
                role.role_name
            );
            return `
            (
            $${offset + 1},$${offset + 2}

            )
            `;
        });

    const result = await query(
        `
        INSERT INTO roles(
         school_id,
         role_name
        )
        VALUES${placeholders.join(", ")}
        RETURNING*
        `,
        values
    );
    return result.rows;
}
