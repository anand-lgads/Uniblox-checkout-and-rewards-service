// This is the ONLY file that knows which database is in use. Adding a
// real DB later means adding one more branch below (and its import) -
// nothing in app.ts, the services, or server.ts should have to change.
// Each Db implementation decides for itself what "ready to serve
// requests" means (see Db.initialize in ./store/db.ts) - this file
// just calls it.

import type { Db } from "./store/db.ts";
import { createInMemoryDb } from "./store/inMemoryStore.ts";
import { createPostgresDb } from "./store/postgresStore.ts";

import { CartService } from "./services/cartService.ts";
import { CouponService } from "./services/couponService.ts";
import { ReportService } from "./services/reportService.ts";

export interface MilestoneConfig {
    milestoneN: number;
    discountPercent: number;
}

async function connectDb(): Promise<Db> {
    const dbBackend = process.env.DB_BACKEND ?? "memory";

    switch (dbBackend) {
        case "memory":
            return createInMemoryDb();
        case "postgres":
            return createPostgresDb({
                connectionString: process.env.DATABASE_URL ?? "",
            });
        default:
            throw new Error(`Unsupported DB_BACKEND: ${dbBackend}`);
    }
}

export async function initDependencies(config: MilestoneConfig) {
    const db = await connectDb();
    await db.initialize();

    const couponService = new CouponService(
        db.coupons,
        db.orders,
        db.unitOfWork,
        config.milestoneN,
        config.discountPercent
    );

    const cartService = new CartService(
        db.products,
        db.carts,
        db.orders,
        db.coupons,
        db.unitOfWork
    );

    const reportService = new ReportService(db.orders, db.coupons);

    return {
        products: db.products,
        orders: db.orders,
        cartService,
        couponService,
        reportService,
    };
}
