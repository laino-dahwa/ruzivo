import { Pool,PoolClient,QueryConfig } from "pg";


declare global {
    var __postgresPoolPromise :
    Promise<Pool>|null|undefined;
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

    const pool = new Pool({
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
        max: 10,
        // pg's default closes a connection after 10s idle, which is shorter
        // than it takes to fill in a form — so nearly every save paid for a
        // brand-new connection. On Windows that means Postgres starting a
        // whole new backend process, plus auth and a cold catalog cache,
        // every time. Idle connections are kept open instead; there are at
        // most `max` of them.
        idleTimeoutMillis: 0,
        keepAlive: true,
    });

    // A long-lived idle connection can be dropped from the server side (a
    // restart, a network blip). pg-pool discards that client itself, but the
    // error is re-emitted here, and an unhandled 'error' event would take the
    // whole server process down.
    pool.on("error", (error) => {
        console.error("Idle Postgres connection lost:", error.message);
    });

    return pool;
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
