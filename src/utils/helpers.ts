import http from "node:http";
import type { AddressInfo } from "node:net";
import { createInMemoryDb } from "../store/inMemoryStore.ts";
import { CartService } from "../services/cartService.ts";
import { CouponService } from "../services/couponService.ts";
import { ReportService } from "../services/reportService.ts";
import { createApp } from "../app.ts";

export async function startTestServer(opts?: { milestoneN?: number; discountPercent?: number }) {
    const db = createInMemoryDb();
    await db.initialize();

    const cartService = new CartService(
        db.products,
        db.carts,
        db.orders,
        db.coupons,
        db.unitOfWork
    );
    const couponService = new CouponService(
        db.coupons,
        db.orders,
        db.unitOfWork,
        opts?.milestoneN ?? 5,
        opts?.discountPercent ?? 10
    );
    const reportService = new ReportService(db.orders, db.coupons);

    const handleRequest = createApp({
        products: db.products,
        orders: db.orders,
        cartService,
        couponService,
        reportService,
    });

    const server = http.createServer(handleRequest);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
        const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : null };
    }

    async function close() {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    return { db, baseUrl, api, close };
}
