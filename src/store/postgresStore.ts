import type { Db } from "./db.ts";

// Not implemented yet. When you're ready to swap off in-memory storage,
// this file's job is to build repositories/UnitOfWork backed by a real
// connection pool and return the same Db shape createInMemoryDb does.
// init.ts and everything upstream of it stays untouched.
export async function createPostgresDb(config: {
    connectionString: string;
}): Promise<Db> {
    throw new Error("createPostgresDb is not implemented yet");

    // Sketch of what this becomes:
    //
    // const pool = new Pool({ connectionString: config.connectionString });
    // return {
    //     products: new PostgresProductRepository(pool),
    //     carts: new PostgresCartRepository(pool),
    //     orders: new PostgresOrderRepository(pool),
    //     coupons: new PostgresCouponRepository(pool),
    //     unitOfWork: new PostgresUnitOfWork(pool), // BEGIN/COMMIT/ROLLBACK
    //     async initialize() {
    //         // Tables come from migrations run ahead of time (e.g. via
    //         // node-pg-migrate or a plain SQL migration runner) - not
    //         // from application startup. Seeding real production data
    //         // here would risk duplicating/stomping rows on every
    //         // restart, so this is intentionally a no-op (or, at most,
    //         // a connectivity check).
    //         await pool.query("SELECT 1");
    //     },
    // };
}
