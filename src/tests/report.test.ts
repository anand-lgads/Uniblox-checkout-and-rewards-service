import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer } from "../utils/helpers.ts";

async function placeOrder(
    server: Awaited<ReturnType<typeof startTestServer>>,
    productId: number,
    quantity: number,
    opts?: { couponCode?: string; idempotencyKey?: string }
) {
    const { body: cart } = await server.api("POST", "/carts");
    await server.api("POST", `/carts/${cart.id}/items`, { productId, quantity });
    return server.api("POST", `/carts/${cart.id}/checkout`, {
        idempotencyKey: opts?.idempotencyKey ?? randomUUID(),
        couponCode: opts?.couponCode,
    });
}

describe("GET /admin/report", () => {
    let server: Awaited<ReturnType<typeof startTestServer>>;

    afterEach(async () => {
        await server?.close();
    });

    test("returns all-zero figures before any orders exist", async () => {
        server = await startTestServer();

        const { status, body } = await server.api("GET", "/admin/report");

        assert.equal(status, 200);
        assert.deepEqual(body.purchasedQuantityByProduct, []);
        assert.equal(body.grossRevenueCents, 0);
        assert.equal(body.totalDiscountCents, 0);
        assert.equal(body.netRevenueCents, 0);
        assert.deepEqual(body.coupons, { generated: 0, available: 0, redeemed: 0 });
        assert.equal(body.totalSuccessfulOrders, 0);
    });

    test("aggregates quantity, revenue, and order count across multiple orders and products", async () => {
        server = await startTestServer();

        // Order A: 2x Ceramic Mug (1299) + 1x Dot-Grid Notebook (899) = 3497
        const { body: cartA } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cartA.id}/items`, { productId: 1, quantity: 2 });
        await server.api("POST", `/carts/${cartA.id}/items`, { productId: 2, quantity: 1 });
        await server.api("POST", `/carts/${cartA.id}/checkout`, { idempotencyKey: randomUUID() });

        // Order B: 3x Gel Pen (249) = 747
        await placeOrder(server, 3, 3);

        const { status, body } = await server.api("GET", "/admin/report");

        assert.equal(status, 200);
        assert.equal(body.totalSuccessfulOrders, 2);
        assert.equal(body.grossRevenueCents, 3497 + 747);
        assert.equal(body.totalDiscountCents, 0);
        assert.equal(body.netRevenueCents, 3497 + 747);

        const byProduct = new Map(body.purchasedQuantityByProduct.map((p: any) => [p.productId, p.quantity]));
        assert.equal(byProduct.get(1), 2);
        assert.equal(byProduct.get(2), 1);
        assert.equal(byProduct.get(3), 3);
    });

    test("accounts for coupons generated, redeemed, and still available", async () => {
        server = await startTestServer({ milestoneN: 2, discountPercent: 10 });

        await placeOrder(server, 3, 1);
        await placeOrder(server, 3, 1);
        const { body: coupon1 } = await server.api("POST", "/admin/coupons/generate"); // milestone 1, unused

        await placeOrder(server, 3, 1);
        await placeOrder(server, 3, 1);
        const { body: coupon2 } = await server.api("POST", "/admin/coupons/generate"); // milestone 2, will be redeemed

        await placeOrder(server, 4, 1, { couponCode: coupon2.code });

        const { body } = await server.api("GET", "/admin/report");

        assert.deepEqual(body.coupons, { generated: 2, available: 1, redeemed: 1 });
        // Sanity: the still-available one is the one we never redeemed.
        assert.notEqual(coupon1.code, coupon2.code);
    });

    test("report figures reconcile exactly with independently-fetched orders and coupons", async () => {
        server = await startTestServer({ milestoneN: 1, discountPercent: 15 });

        const orderResults = [
            await placeOrder(server, 1, 1), // no coupon yet
        ];
        const { body: coupon } = await server.api("POST", "/admin/coupons/generate");
        orderResults.push(await placeOrder(server, 4, 2, { couponCode: coupon.code }));
        orderResults.push(await placeOrder(server, 3, 5));

        const orders = orderResults.map((r) => r.body);

        // Manually compute expected aggregates purely from the order
        // bodies the API already gave us - independent of report.build()'s
        // own implementation.
        let expectedGross = 0;
        let expectedDiscount = 0;
        const expectedByProduct = new Map<number, number>();
        for (const order of orders) {
            expectedGross += order.grossCents;
            expectedDiscount += order.discountCents;
            for (const item of order.items) {
                expectedByProduct.set(
                    item.productId,
                    (expectedByProduct.get(item.productId) ?? 0) + item.quantity
                );
            }
        }

        const { body: couponsList } = await server.api("GET", "/admin/coupons");
        const expectedCoupons = {
            generated: couponsList.length,
            available: couponsList.filter((c: any) => c.status === "AVAILABLE").length,
            redeemed: couponsList.filter((c: any) => c.status === "REDEEMED").length,
        };

        const { body: report } = await server.api("GET", "/admin/report");

        assert.equal(report.totalSuccessfulOrders, orders.length);
        assert.equal(report.grossRevenueCents, expectedGross);
        assert.equal(report.totalDiscountCents, expectedDiscount);
        assert.equal(report.netRevenueCents, expectedGross - expectedDiscount);
        assert.deepEqual(report.coupons, expectedCoupons);

        const reportByProduct = new Map(
            report.purchasedQuantityByProduct.map((p: any) => [p.productId, p.quantity])
        );
        assert.deepEqual(reportByProduct, expectedByProduct);
    });

    test("an idempotent replay does not inflate the report", async () => {
        server = await startTestServer();

        const { body: cart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 1, quantity: 1 });
        const idempotencyKey = randomUUID();

        await server.api("POST", `/carts/${cart.id}/checkout`, { idempotencyKey });
        const before = await server.api("GET", "/admin/report");

        // Replay the exact same checkout request.
        const replay = await server.api("POST", `/carts/${cart.id}/checkout`, { idempotencyKey });
        assert.equal(replay.body.idempotentReplay, true);

        const after = await server.api("GET", "/admin/report");

        assert.deepEqual(after.body, before.body);
        assert.equal(after.body.totalSuccessfulOrders, 1);
    });

    test("repeated calls to the report are read-only and return identical results", async () => {
        server = await startTestServer({ milestoneN: 1, discountPercent: 10 });

        await placeOrder(server, 2, 1);
        await server.api("POST", "/admin/coupons/generate");
        await placeOrder(server, 3, 4);

        const first = await server.api("GET", "/admin/report");
        const second = await server.api("GET", "/admin/report");
        const third = await server.api("GET", "/admin/report");

        assert.deepEqual(first.body, second.body);
        assert.deepEqual(second.body, third.body);
    });
});
