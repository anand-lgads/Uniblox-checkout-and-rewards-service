import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startTestServer } from "../utils/helpers.ts";

describe("Checkout validation", () => {
    let server: Awaited<ReturnType<typeof startTestServer>>;

    afterEach(async () => {
        await server?.close();
    });

    test("400s on checkout of an empty cart", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");

        const { status, body } = await server.api("POST", `/carts/${cart.id}/checkout`, {
            idempotencyKey: randomUUID(),
        });

        assert.equal(status, 400);
        assert.equal(body.error.code, "CART_EMPTY");
    });

    test("400s when idempotencyKey is missing", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 1, quantity: 1 });

        const { status, body } = await server.api("POST", `/carts/${cart.id}/checkout`, {});

        assert.equal(status, 400);
        assert.equal(body.error.code, "IDEMPOTENCY_KEY_REQUIRED");
    });

    test("404s when checking out a cart that doesn't exist", async () => {
        server = await startTestServer();

        const { status, body } = await server.api("POST", "/carts/does-not-exist/checkout", {
            idempotencyKey: randomUUID(),
        });

        assert.equal(status, 404);
        assert.equal(body.error.code, "CART_NOT_FOUND");
    });

    test("409s on a second checkout attempt against an already-completed cart", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 1, quantity: 1 });

        const first = await server.api("POST", `/carts/${cart.id}/checkout`, {
            idempotencyKey: randomUUID(),
        });
        assert.equal(first.status, 201);

        // A different idempotency key, so this is a genuinely new request
        // against an already-completed cart - not a replay.
        const { status, body } = await server.api("POST", `/carts/${cart.id}/checkout`, {
            idempotencyKey: randomUUID(),
        });

        assert.equal(status, 409);
        assert.equal(body.error.code, "CART_ALREADY_CHECKED_OUT");
    });

    test("checkout re-validates inventory against current data, not the cart's snapshot", async () => {
        server = await startTestServer();

        // Cart A reserves nothing yet - it just adds 2 of the 3 available
        // hoodies (product 5). This passes the soft add-time check.
        const { body: cartA } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cartA.id}/items`, { productId: 5, quantity: 2 });

        // Cart B buys all 3 hoodies and checks out first, draining stock
        // to 0 before cart A ever gets to checkout.
        const { body: cartB } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cartB.id}/items`, { productId: 5, quantity: 3 });
        const checkoutB = await server.api("POST", `/carts/${cartB.id}/checkout`, {
            idempotencyKey: randomUUID(),
        });
        assert.equal(checkoutB.status, 201);

        // Cart A's checkout must fail against the *current* inventory (0
        // left), even though it looked fine when the item was added.
        const { status, body } = await server.api("POST", `/carts/${cartA.id}/checkout`, {
            idempotencyKey: randomUUID(),
        });

        assert.equal(status, 409);
        assert.equal(body.error.code, "INSUFFICIENT_INVENTORY");
        assert.equal(body.error.details.requested, 2);
        assert.equal(body.error.details.available, 0);

        // Cart A itself must remain un-completed and mutable-in-principle
        // after the failed checkout (still ACTIVE).
        const { body: cartAView } = await server.api("GET", `/carts/${cartA.id}`);
        assert.equal(cartAView.status, "ACTIVE");
        assert.equal(cartAView.orderId, null);
    });

    test("a coupon supplied on a checkout that fails is left untouched (not lost or consumed)", async () => {
        server = await startTestServer({ milestoneN: 1, discountPercent: 10 });

        // Reach milestone 1 and mint a coupon.
        const { body: seedCart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${seedCart.id}/items`, { productId: 3, quantity: 1 });
        await server.api("POST", `/carts/${seedCart.id}/checkout`, { idempotencyKey: randomUUID() });
        const { body: coupon } = await server.api("POST", "/admin/coupons/generate");
        assert.equal(coupon.status, "AVAILABLE");

        // Drain the hoodie stock via a separate order.
        const { body: cart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 5, quantity: 1 });

        const { body: drainCart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${drainCart.id}/items`, { productId: 5, quantity: 3 });
        await server.api("POST", `/carts/${drainCart.id}/checkout`, { idempotencyKey: randomUUID() });

        // This checkout supplies the valid coupon, but fails for an
        // unrelated reason (no hoodie stock left, drained above).
        const { status, body } = await server.api("POST", `/carts/${cart.id}/checkout`, {
            idempotencyKey: randomUUID(),
            couponCode: coupon.code,
        });

        assert.equal(status, 409);
        assert.equal(body.error.code, "INSUFFICIENT_INVENTORY");

        // The coupon must still be available - the failed checkout must
        // not have redeemed or otherwise consumed it.
        const { body: coupons } = await server.api("GET", "/admin/coupons");
        const stillThere = coupons.find((c: any) => c.code === coupon.code);
        assert.equal(stillThere.status, "AVAILABLE");
        assert.equal(stillThere.redeemedByOrderId, null);
    });

    test("a successful checkout returns a complete, retrievable order", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 1, quantity: 2 });
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 2, quantity: 1 });

        const idempotencyKey = randomUUID();
        const { status, body: order } = await server.api("POST", `/carts/${cart.id}/checkout`, {
            idempotencyKey,
        });

        assert.equal(status, 201);
        assert.equal(typeof order.id, "string");
        assert.equal(typeof order.orderNumber, "number");
        assert.equal(order.cartId, cart.id);
        assert.equal(order.clientId, 1); // default clientId when none was given
        assert.equal(order.items.length, 2);
        assert.equal(order.grossCents, 2 * 1299 + 899); // 3497
        assert.equal(order.discountCents, 0);
        assert.equal(order.netCents, 3497);
        assert.equal(order.couponCode, null);
        assert.equal(order.idempotencyKey, idempotencyKey);
        assert.equal(order.idempotentReplay, false);
        assert.ok(order.placedAt);

        const { status: getStatus, body: fetched } = await server.api("GET", `/orders/${order.id}`);
        assert.equal(getStatus, 200);
        const { idempotentReplay, ...orderWithoutReplay } = order;

        assert.deepEqual(fetched, orderWithoutReplay);

        // The cart itself is now completed and points at the order.
        const { body: cartView } = await server.api("GET", `/carts/${cart.id}`);
        assert.equal(cartView.status, "COMPLETED");
        assert.equal(cartView.orderId, order.id);
    });

    test("404s when retrieving an order that doesn't exist", async () => {
        server = await startTestServer();

        const { status, body } = await server.api("GET", "/orders/does-not-exist");

        assert.equal(status, 404);
        assert.equal(body.error.code, "ORDER_NOT_FOUND");
    });
});
