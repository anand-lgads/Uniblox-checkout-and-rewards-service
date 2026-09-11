import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer } from "../utils/helpers.ts";

describe("Concurrency", () => {
    let server: Awaited<ReturnType<typeof startTestServer>>;

    afterEach(async () => {
        await server?.close();
    });

    test("prevents oversell when concurrent checkouts race for limited inventory", async () => {
        server = await startTestServer();

        // Product 5 (Limited Edition Hoodie) is seeded with only 3 units.
        // 5 separate carts each buy 1, and all 5 checkouts fire at once.
        const cartIds = await Promise.all(
            Array.from({ length: 5 }, async () => {
                const { body: cart } = await server.api("POST", "/carts");
                await server.api("POST", `/carts/${cart.id}/items`, { productId: 5, quantity: 1 });
                return cart.id;
            })
        );

        const results = await Promise.all(
            cartIds.map((cartId) =>
                server.api("POST", `/carts/${cartId}/checkout`, { idempotencyKey: randomUUID() })
            )
        );

        const succeeded = results.filter((r) => r.status === 201);
        const rejected = results.filter((r) => r.status === 409);

        assert.equal(succeeded.length, 3, "exactly 3 units were available");
        assert.equal(rejected.length, 2);
        for (const r of rejected) {
            assert.equal(r.body.error.code, "INSUFFICIENT_INVENTORY");
        }

        // Inventory must land exactly at 0, never negative, regardless of
        // request arrival order.
        const { body: products } = await server.api("GET", "/products");
        const hoodie = products.find((p: any) => p.id === 5);
        assert.equal(hoodie.inventoryUnits, 0);
    });

    test("concurrent retries with the same idempotency key produce exactly one order", async () => {
        server = await startTestServer();

        const { body: cart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 3, quantity: 1 });
        const idempotencyKey = randomUUID();

        // Simulates 5 near-simultaneous client retries of the same
        // logical request (e.g. a flaky connection).
        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                server.api("POST", `/carts/${cart.id}/checkout`, { idempotencyKey })
            )
        );

        const orderIds = new Set(results.map((r) => r.body.id));
        assert.equal(orderIds.size, 1, "all concurrent retries must resolve to the same order");

        const statuses = results.map((r) => r.status).sort();
        // Exactly one call actually created the order (201); the rest
        // observed it already existed and replayed it (200).
        assert.equal(statuses.filter((s) => s === 201).length, 1);
        assert.equal(statuses.filter((s) => s === 200).length, 4);

        // Inventory was only decremented once, not once per retry.
        const { body: products } = await server.api("GET", "/products");
        const pen = products.find((p: any) => p.id === 3);
        assert.equal(pen.inventoryUnits, 199);
    });

    test("concurrent checkouts racing for the same coupon: only one redeems it", async () => {
        server = await startTestServer({ milestoneN: 1, discountPercent: 10 });

        // Reach milestone 1 and mint a coupon.
        const { body: seedCart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${seedCart.id}/items`, { productId: 3, quantity: 1 });
        await server.api("POST", `/carts/${seedCart.id}/checkout`, { idempotencyKey: randomUUID() });
        const { body: coupon } = await server.api("POST", "/admin/coupons/generate");

        // 5 separate carts all try to redeem the same coupon at once.
        const cartIds = await Promise.all(
            Array.from({ length: 5 }, async () => {
                const { body: cart } = await server.api("POST", "/carts");
                await server.api("POST", `/carts/${cart.id}/items`, { productId: 3, quantity: 1 });
                return cart.id;
            })
        );

        const results = await Promise.all(
            cartIds.map((cartId) =>
                server.api("POST", `/carts/${cartId}/checkout`, {
                    idempotencyKey: randomUUID(),
                    couponCode: coupon.code,
                })
            )
        );

        const succeeded = results.filter((r) => r.status === 201);
        const rejected = results.filter((r) => r.status === 409);

        assert.equal(succeeded.length, 1);
        assert.ok(succeeded[0].body.discountCents > 0);
        assert.equal(rejected.length, 4);
        for (const r of rejected) {
            assert.equal(r.body.error.code, "COUPON_ALREADY_REDEEMED");
        }
    });

    test("concurrent admin calls to generate a coupon mint it exactly once", async () => {
        server = await startTestServer({ milestoneN: 1, discountPercent: 10 });

        const { body: cart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 3, quantity: 1 });
        await server.api("POST", `/carts/${cart.id}/checkout`, { idempotencyKey: randomUUID() });

        const results = await Promise.all(
            Array.from({ length: 5 }, () => server.api("POST", "/admin/coupons/generate"))
        );

        const succeeded = results.filter((r) => r.status === 201);
        const rejected = results.filter((r) => r.status === 409);

        assert.equal(succeeded.length, 1);
        assert.equal(rejected.length, 4);
        for (const r of rejected) {
            assert.equal(r.body.error.code, "NO_ELIGIBLE_MILESTONE");
        }

        const { body: coupons } = await server.api("GET", "/admin/coupons");
        assert.equal(coupons.length, 1);
    });
});
