import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../utils/helpers.ts";

describe("Cart", () => {
    let server: Awaited<ReturnType<typeof startTestServer>>;

    afterEach(async () => {
        await server?.close();
    });

    test("POST /carts creates an empty active cart", async () => {
        server = await startTestServer();
        const { status, body } = await server.api("POST", "/carts");

        assert.equal(status, 201);
        assert.equal(typeof body.id, "string");
        assert.equal(body.status, "ACTIVE");
        assert.deepEqual(body.items, []);
        assert.equal(body.subtotalCents, 0);
        assert.equal(body.orderId, null);
    });

    test("GET /carts/:cartId returns 404 for an unknown cart", async () => {
        server = await startTestServer();
        const { status, body } = await server.api("GET", "/carts/does-not-exist");

        assert.equal(status, 404);
        assert.equal(body.error.code, "CART_NOT_FOUND");
    });

    test("POST /carts/:cartId/items adds an item, re-priced against current product data", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");

        const { status, body } = await server.api("POST", `/carts/${cart.id}/items`, {
            productId: 1,
            quantity: 2,
        });

        assert.equal(status, 201);
        assert.equal(body.items.length, 1);
        assert.deepEqual(body.items[0], {
            productId: 1,
            name: "Ceramic Mug",
            quantity: 2,
            unitPriceCents: 1299,
            lineTotalCents: 2598,
            availableInventory: 50,
            sufficientInventory: true,
        });
        assert.equal(body.subtotalCents, 2598);
    });

    test("adding the same product twice merges quantities instead of duplicating the line", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");

        await server.api("POST", `/carts/${cart.id}/items`, { productId: 2, quantity: 1 });
        const { body } = await server.api("POST", `/carts/${cart.id}/items`, { productId: 2, quantity: 3 });

        assert.equal(body.items.length, 1);
        assert.equal(body.items[0].quantity, 4);
    });

    test("POST .../items rejects a non-numeric productId", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");

        const { status, body } = await server.api("POST", `/carts/${cart.id}/items`, {
            productId: "one",
            quantity: 1,
        });

        assert.equal(status, 400);
        assert.equal(body.error.code, "VALIDATION_ERROR");
    });

    test("POST .../items rejects a zero/non-positive quantity", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");

        const { status, body } = await server.api("POST", `/carts/${cart.id}/items`, {
            productId: 1,
            quantity: 0,
        });

        assert.equal(status, 400);
        assert.equal(body.error.code, "VALIDATION_ERROR");
    });

    test("POST .../items 404s for a product that doesn't exist", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");

        const { status, body } = await server.api("POST", `/carts/${cart.id}/items`, {
            productId: 999,
            quantity: 1,
        });

        assert.equal(status, 404);
        assert.equal(body.error.code, "PRODUCT_NOT_FOUND");
    });

    test("POST .../items 409s when requested quantity exceeds inventory", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");

        // Product 5 (Limited Edition Hoodie) is seeded with only 3 units.
        const { status, body } = await server.api("POST", `/carts/${cart.id}/items`, {
            productId: 5,
            quantity: 4,
        });

        assert.equal(status, 409);
        assert.equal(body.error.code, "INSUFFICIENT_INVENTORY");
        assert.equal(body.error.details.available, 3);
        assert.equal(body.error.details.requested, 4);
    });

    test("adding a product twice can exceed inventory on the second add even though each add alone would not", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");

        await server.api("POST", `/carts/${cart.id}/items`, { productId: 5, quantity: 2 });
        const { status, body } = await server.api("POST", `/carts/${cart.id}/items`, {
            productId: 5,
            quantity: 2,
        });

        assert.equal(status, 409);
        assert.equal(body.error.code, "INSUFFICIENT_INVENTORY");
        assert.equal(body.error.details.requested, 4); // 2 existing + 2 new
    });

    test("PUT .../items/:productId sets the quantity", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 3, quantity: 5 });

        const { status, body } = await server.api("PUT", `/carts/${cart.id}/items/3`, { quantity: 10 });

        assert.equal(status, 200);
        assert.equal(body.items[0].quantity, 10);
    });

    test("PUT .../items/:productId with quantity 0 removes the item", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 3, quantity: 5 });

        const { status, body } = await server.api("PUT", `/carts/${cart.id}/items/3`, { quantity: 0 });

        assert.equal(status, 200);
        assert.deepEqual(body.items, []);
    });

    test("PUT .../items/:productId 409s when the new quantity exceeds inventory", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 5, quantity: 1 });

        const { status, body } = await server.api("PUT", `/carts/${cart.id}/items/5`, { quantity: 4 });

        assert.equal(status, 409);
        assert.equal(body.error.code, "INSUFFICIENT_INVENTORY");
    });

    test("PUT .../items/:productId 404s when the product isn't in the cart", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");

        const { status, body } = await server.api("PUT", `/carts/${cart.id}/items/1`, { quantity: 2 });

        assert.equal(status, 404);
        assert.equal(body.error.code, "CART_ITEM_NOT_FOUND");
    });

    test("DELETE .../items/:productId removes the item", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 4, quantity: 1 });

        const { status, body } = await server.api("DELETE", `/carts/${cart.id}/items/4`);

        assert.equal(status, 200);
        assert.deepEqual(body.items, []);
    });

    test("DELETE .../items/:productId 404s when the product isn't in the cart", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");

        const { status, body } = await server.api("DELETE", `/carts/${cart.id}/items/4`);

        assert.equal(status, 404);
        assert.equal(body.error.code, "CART_ITEM_NOT_FOUND");
    });

    test("GET /carts/:cartId reflects a live price change in current product data", async () => {
        server = await startTestServer();
        const { body: cart } = await server.api("POST", "/carts");
        await server.api("POST", `/carts/${cart.id}/items`, { productId: 5, quantity: 3 });

        // Simulate another checkout consuming the remaining stock elsewhere,
        // so this cart's snapshot is now stale.
        const product = await server.db.products.findById(5);
        assert.ok(product);
        product.inventoryUnits = 1;
        await server.db.products.save(product);

        const { status, body } = await server.api("GET", `/carts/${cart.id}`);

        assert.equal(status, 200);
        assert.equal(body.pricesAndAvailabilityMayHaveChanged, true);
        assert.equal(body.items[0].sufficientInventory, false);
        assert.equal(body.items[0].availableInventory, 1);
    });
});
