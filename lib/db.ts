import { Pool,PoolClient,QueryConfig } from "pg";


declare global {
    var __postgresPoolPromise :
    Promise<Pool>|null|undefined;
    var __databaseInitialized:Promise<void>|undefined
}
const globalForPostgres = globalThis;

function quoteIdentifier(identifier:string) {
    return `"${identifier.replace(/"/g, '""')}"`;
}

async function createDatabaseIfNotExists() {
    const adminPool = new Pool({
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGADMINDB || "postgres",
    });

    const databaseName = process.env.PGDATABASE;

    if (!databaseName){
        throw new Error("PGDATABASE is not defined")
    }

    try {
        const result = await adminPool.query(
            `
            SELECT 1
            FROM pg_database
            WHERE datname = $1
            `,
            [databaseName]
        );

        if (result.rowCount === 0) {
            await adminPool.query(
                `CREATE DATABASE ${quoteIdentifier(databaseName)}`
            );
        }
    } finally {
        await adminPool.end();
    }
}

async function createPool() {
    await createDatabaseIfNotExists();

    return new Pool({
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
        max: 10,
    });
}

export async function getPool() {
    if (!globalForPostgres.__postgresPoolPromise) {
        globalForPostgres.__postgresPoolPromise = createPool().catch(
            (error) => {
                // Allow a fresh pool initialization attempt after failures.
                globalForPostgres.__postgresPoolPromise = null;
                throw error;
            }
        );
    }

    return globalForPostgres.__postgresPoolPromise;
}

export async function query(text:string, params: QueryConfig["values"]= []) {
    const pool = await getPool();

    return pool.query(text, params);
}


export async function transaction<T>(
    callback: (client: PoolClient)=>
    Promise<T>
    ):Promise<T>{
  const pool  = await getPool()
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await callback(client);

    await client.query("COMMIT");

    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeDatabase() {
    if (!globalForPostgres.__databaseInitialized) {
        globalForPostgres.__databaseInitialized = (async () => {
            await query(`
                CREATE TABLE schools (
                school_id CHAR(4) PRIMARY KEY,
                school_name VARCHAR(200) NOT NULL,
                school_type VARCHAR(100),
                school_address TEXT,
                school_contact VARCHAR(50),
                school_email VARCHAR(255),
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                deleted_at TIMESTAMPTZ
            );


            CREATE TABLE class_categories (
                class_category_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                school_id CHAR(4) NOT NULL,
                class_name VARCHAR(100) NOT NULL,

                CONSTRAINT fk_class_category_school
                    FOREIGN KEY (school_id)
                    REFERENCES schools(school_id),

                CONSTRAINT uq_class_category
                    UNIQUE (school_id, class_name)
            );

            CREATE TABLE payment_periods (
                payment_period_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                school_id CHAR(4) NOT NULL,
                period_name VARCHAR(100) NOT NULL,

                CONSTRAINT fk_payment_period_school
                    FOREIGN KEY (school_id)
                    REFERENCES schools(school_id),

                CONSTRAINT uq_payment_period
                    UNIQUE (school_id, period_name)
            );



            CREATE TABLE expense_categories (
                expense_category_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                school_id CHAR(4) NOT NULL,
                expense_name VARCHAR(150) NOT NULL,

                CONSTRAINT fk_expense_category_school
                    FOREIGN KEY (school_id)
                    REFERENCES schools(school_id),

                CONSTRAINT uq_expense_category
                    UNIQUE (school_id, expense_name)
            );

            CREATE TABLE income_categories (
                income_category_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                school_id CHAR(4) NOT NULL,
                income_name VARCHAR(150) NOT NULL,
                income_limit NUMERIC(12,2),

                CONSTRAINT fk_income_category_school
                    FOREIGN KEY (school_id)
                    REFERENCES schools(school_id),

                CONSTRAINT uq_income_category
                    UNIQUE (school_id, income_name),

                CONSTRAINT chk_income_limit
                    CHECK (income_limit IS NULL OR income_limit >= 0)
            );


            CREATE TABLE academic_years (
                academic_year_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                school_id CHAR(4) NOT NULL,
                name VARCHAR(20) NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,

                CONSTRAINT fk_academic_year_school
                    FOREIGN KEY (school_id)
                    REFERENCES schools(school_id),

                CONSTRAINT uq_academic_year
                    UNIQUE (school_id, name),

                CONSTRAINT chk_academic_year_dates
                    CHECK (end_date > start_date)
            );



            CREATE TABLE learners (
                learner_id VARCHAR(8) PRIMARY KEY,
                school_id CHAR(4) NOT NULL,
                first_name VARCHAR(100) NOT NULL,
                last_name VARCHAR(100) NOT NULL,
                gender_id BIGINT,
                date_of_birth DATE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                deleted_at TIMESTAMPTZ,

                CONSTRAINT fk_learner_school
                    FOREIGN KEY (school_id)
                    REFERENCES schools(school_id),

                CONSTRAINT fk_learner_gender
                    FOREIGN KEY (gender_id)
                    REFERENCES genders(gender_id)
            );


            CREATE TABLE enrolments (
                enrolment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                learner_id VARCHAR(8) NOT NULL,
                class_category_id BIGINT NOT NULL,
                academic_year_id BIGINT NOT NULL,

                CONSTRAINT fk_enrolment_learner
                    FOREIGN KEY (learner_id)
                    REFERENCES learners(learner_id),

                CONSTRAINT fk_enrolment_class
                    FOREIGN KEY (class_category_id)
                    REFERENCES class_categories(class_category_id),

                CONSTRAINT fk_enrolment_year
                    FOREIGN KEY (academic_year_id)
                    REFERENCES academic_years(academic_year_id),

                CONSTRAINT uq_learner_year
                    UNIQUE (learner_id, academic_year_id)

            );


            CREATE TABLE expenses (
                expense_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                expense_category_id BIGINT NOT NULL,
                amount NUMERIC(12,2) NOT NULL,
                expense_date DATE NOT NULL,
                description TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

                CONSTRAINT fk_expense_category
                    FOREIGN KEY (expense_category_id)
                    REFERENCES expense_categories(expense_category_id),

                CONSTRAINT chk_expense_amount
                    CHECK (amount > 0)
            );


            CREATE TABLE charges (
                charge_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                learner_id VARCHAR(8) NOT NULL,
                enrolment_id BIGINT NOT NULL,
                income_category_id BIGINT NOT NULL,
                payment_period_id BIGINT NOT NULL,
                academic_year_id BIGINT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_charge_learner
                    FOREIGN KEY (learner_id)
                    REFERENCES learners(learner_id),

                CONSTRAINT fk_charge_enrolment
                    FOREIGN KEY (enrolment_id)
                    REFERENCES enrolments(enrolment_id),

                CONSTRAINT fk_charge_income_category
                    FOREIGN KEY (income_category_id)
                    REFERENCES income_categories(income_category_id),

                CONSTRAINT fk_charge_period
                    FOREIGN KEY (payment_period_id)
                    REFERENCES payment_periods(payment_period_id),

                CONSTRAINT fk_charge_year
                    FOREIGN KEY (academic_year_id)
                    REFERENCES academic_years(academic_year_id)
            );


            CREATE TABLE payments (
                payment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                amount NUMERIC(12,2) NOT NULL,
                payment_method_id BIGINT,
                paid_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                payment_method VARCHAR(50),
                reference VARCHAR(100),

                CONSTRAINT fk_payment_method
                FOREIGN KEY(payment_method_id)
                REFERENCES payment_methods(payment_method_id),

                CONSTRAINT chk_payment_amount
                    CHECK (amount > 0),

                CONSTRAINT uq_payment_reference
                    UNIQUE (reference)
            );


            CREATE TABLE payment_allocations (
                allocation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                payment_id BIGINT NOT NULL,
                charge_id BIGINT NOT NULL,
            
                CONSTRAINT fk_allocation_payment
                    FOREIGN KEY (payment_id)
                    REFERENCES payments(payment_id),

                CONSTRAINT fk_allocation_charge
                    FOREIGN KEY (charge_id)
                    REFERENCES charges(charge_id),

                CONSTRAINT uq_payment_charge
                    UNIQUE (payment_id, charge_id)
            );


            CREATE TABLE payment_methods (
                payment_method_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                method_name VARCHAR(100) NOT NULL,
            
                CONSTRAINT uq_payment_method
                    UNIQUE (payment_method_id, method_name)
            );

            CREATE TABLE genders (
                gender_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                gender_name VARCHAR(100) NOT NULL,
            
                CONSTRAINT uq_gender
                    UNIQUE (gender_id, gender_name)
            );



            `);
        })();
    }

    return globalForPostgres.__databaseInitialized;
}