-- Up Migration
--
-- Roles become their own per-school reference table (like genders,
-- class_categories, …) instead of free text on employees, so "Teacher"
-- typed two different ways doesn't produce two different roles and the
-- Employees form can offer a dropdown instead of an open text field.

CREATE TABLE roles (
    role_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id CHAR(4) NOT NULL,
    role_name VARCHAR(100) NOT NULL,

    CONSTRAINT fk_role_school
        FOREIGN KEY (school_id)
        REFERENCES schools(school_id)
        ON DELETE CASCADE,

    CONSTRAINT uq_role
        UNIQUE (school_id, role_name)
);

-- One role row per distinct (school_id, role) already on an employee, so
-- existing employees keep their role under the new table instead of losing it.
INSERT INTO roles (school_id, role_name)
SELECT DISTINCT school_id, role FROM employees
ON CONFLICT (school_id, role_name) DO NOTHING;

ALTER TABLE employees ADD COLUMN role_id BIGINT;

UPDATE employees e
SET role_id = r.role_id
FROM roles r
WHERE r.school_id = e.school_id AND r.role_name = e.role;

ALTER TABLE employees ALTER COLUMN role_id SET NOT NULL;

-- Not cascading: removing a role must not silently delete the employees who
-- hold it (deleteRole refuses while any employee still references it — see
-- repositories/school/referenceTable.ts).
ALTER TABLE employees
    ADD CONSTRAINT fk_employee_role
        FOREIGN KEY (role_id)
        REFERENCES roles(role_id);

ALTER TABLE employees DROP COLUMN role;

-- Down Migration

ALTER TABLE employees ADD COLUMN role VARCHAR(100);

UPDATE employees e
SET role = r.role_name
FROM roles r
WHERE r.role_id = e.role_id;

ALTER TABLE employees ALTER COLUMN role SET NOT NULL;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS fk_employee_role;
ALTER TABLE employees DROP COLUMN role_id;

DROP TABLE IF EXISTS roles;
