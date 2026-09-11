import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer } from "../utils/helpers.ts";

// Places one successful order (Gel Pen, id 3 - 200 units seeded, never a
// realistic risk of running out across these tests) so tests can drive
// the order count up to a milestone without worrying about inventory.
async function placeOrder(
    server: Awaited<ReturnType<typeof startTestServer>>,
    opts?: { couponCode?: string }
) {
    const { body: cart } = await server.api("POST", "/carts");
    await server.api("POST", `/carts/${cart.id}/items`, { productId: 3, quantity: 1 });
    return server.api("POST", `/carts/${cart.id}/checkout`, {
        idempotencyKey: randomUUID(),
        couponCode: opts?.couponCode,
    });
}

describe("Coupons", () => {
    let server: Awaited<ReturnType<typeof startTestServer>>;

    afterEach(async () => {
        await server?.close();
    });

    test("POST /admin/coupons/generate 409s when no milestone has been reached yet", async () => {
        server = await startTestServer({ milestoneN: 2, discountPercent: 10 });

        const { status, body } = await server.api("POST", "/admin/coupons/generate");

        assert.equal(status, 409);
        assert.equal(body.error.code, "NO_ELIGIBLE_MILESTONE");
        assert.equal(body.error.details.successfulOrderCount, 0);
    });

    test("generates a coupon once the milestone order count is reached", async () => {
        server = await startTestServer({ milestoneN: 2, discountPercent: 10 });

        await placeOrder(server);
        await placeOrder(server);

        const { status, body } = await server.api("POST", "/admin/coupons/generate");

        assert.equal(status, 201);
        assert.equal(body.code, "SAVE10-M1");
        assert.equal(body.discountPercent, 10);
        assert.equal(body.milestone, 1);
        assert.equal(body.status, "AVAILABLE");
    });

    test("generating again before the next milestone 409s, even with orders in between", async () => {
        server = await startTestServer({ milestoneN: 2, discountPercent: 10 });

        await placeOrder(server);
        await placeOrder(server);
        await server.api("POST", "/admin/coupons/generate"); // mints milestone 1

        const { status, body } = await server.api("POST", "/admin/coupons/generate");

        assert.equal(status, 409);
        assert.equal(body.error.code, "NO_ELIGIBLE_MILESTONE");
    });

    test("reaching the next milestone allows generating the next coupon", async () => {
        server = await startTestServer({ milestoneN: 2, discountPercent: 10 });

        await placeOrder(server);
        await placeOrder(server);
        await server.api("POST", "/admin/coupons/generate"); // milestone 1

        await placeOrder(server);
        await placeOrder(server);

        const { status, body } = await server.api("POST", "/admin/coupons/generate");

        assert.equal(status, 201);
        assert.equal(body.code, "SAVE10-M2");
        assert.equal(body.milestone, 2);
    });

    test("GET /admin/coupons lists every generated coupon", async () => {
        server = await startTestServer({ milestoneN: 2, discountPercent: 10 });

        await placeOrder(server);
        await placeOrder(server);
        await server.api("POST", "/admin/coupons/generate");

        const { status, body } = await server.api("GET", "/admin/coupons");

        assert.equal(status, 200);
        assert.equal(body.length, 1);
        assert.equal(body[0].code, "SAVE10-M1");
        assert.equal(body[0].status, "AVAILABLE");
    });

    test("checkout applies a valid coupon's discount and marks it redeemed", async () => {
        server = await startTestServer({ milestoneN: 2, discountPercent: 10 });

        await placeOrder(server);
        await placeOrder(server);
        const { body: coupon } = await server.api("POST", "/admin/coupons/generate");

        const { status, body: order } = await placeOrder(server, { couponCode: coupon.code });

        assert.equal(status, 201);
        assert.equal(order.couponCode, coupon.code);
        assert.equal(order.grossCents, 249);
        assert.equal(order.discountCents, 24); // floor(249 * 10 / 100)
        assert.equal(order.netCents, 225);

        const { body: coupons } = await server.api("GET", "/admin/coupons");
        const redeemed = coupons.find((c: any) => c.code === coupon.code);
        assert.equal(redeemed.status, "REDEEMED");
        assert.equal(redeemed.redeemedByOrderId, order.id);
    });

    test("checkout 409s when reusing an already-redeemed coupon", async () => {
        server = await startTestServer({ milestoneN: 2, discountPercent: 10 });

        await placeOrder(server);
        await placeOrder(server);
        const { body: coupon } = await server.api("POST", "/admin/coupons/generate");

        await placeOrder(server, { couponCode: coupon.code }); // redeems it

        const { status, body } = await placeOrder(server, { couponCode: coupon.code });

        assert.equal(status, 409);
        assert.equal(body.error.code, "COUPON_ALREADY_REDEEMED");
    });

    test("checkout 400s for an unknown coupon code", async () => {
        server = await startTestServer();

        const { status, body } = await placeOrder(server, { couponCode: "NOT-REAL" });

        assert.equal(status, 400);
        assert.equal(body.error.code, "COUPON_INVALID");
    });

    test("an idempotent replay does not count twice toward the milestone", async () => {
        server = await startTestServer({ milestoneN: 2, discountPercent: 10 });

        const { body: cart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 3, quantity: 1 });
        const idempotencyKey = randomUUID();

        const first = await server.api("POST", `/carts/${cart.id}/checkout`, { idempotencyKey });
        const replay = await server.api("POST", `/carts/${cart.id}/checkout`, { idempotencyKey });

        assert.equal(first.status, 201);
        assert.equal(replay.status, 200);
        assert.equal(replay.body.idempotentReplay, true);
        assert.equal(replay.body.id, first.body.id);

        // Only one order actually exists, so milestone 1 (which needs 2
        // orders) hasn't really been reached - even though checkout was
        // "called" twice.
        const { status, body } = await server.api("POST", "/admin/coupons/generate");

        assert.equal(status, 409);
        assert.equal(body.error.code, "NO_ELIGIBLE_MILESTONE");
        assert.equal(body.error.details.successfulOrderCount, 1);
    });
});
