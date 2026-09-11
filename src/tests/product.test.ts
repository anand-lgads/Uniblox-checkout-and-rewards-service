import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../utils/helpers.ts";

describe("GET /products", () => {
    let server: Awaited<ReturnType<typeof startTestServer>>;

    afterEach(async () => {
        await server?.close();
    });

    test("returns 200 with the full seeded catalog", async () => {
        server = await startTestServer();
        const { status, body } = await server.api("GET", "/products");

        assert.equal(status, 200);
        assert.equal(body.length, 5);
    });

    test("each product has the expected shape", async () => {
        server = await startTestServer();
        const { body } = await server.api("GET", "/products");

        for (const product of body) {
            assert.equal(typeof product.id, "number");
            assert.equal(typeof product.name, "string");
            assert.equal(typeof product.priceCents, "number");
            assert.equal(typeof product.inventoryUnits, "number");
        }
    });

    test("includes known seed data with correct price and inventory", async () => {
        server = await startTestServer();
        const { body } = await server.api("GET", "/products");

        const mug = body.find((p: any) => p.id === 1);
        assert.ok(mug, "expected seeded product id 1 (Ceramic Mug)");
        assert.equal(mug.name, "Ceramic Mug");
        assert.equal(mug.priceCents, 1299);
        assert.equal(mug.inventoryUnits, 50);

        // Product 5 is deliberately low-stock in the seed data - other
        // tests (oversell / concurrency) depend on this staying true.
        const hoodie = body.find((p: any) => p.id === 5);
        assert.ok(hoodie, "expected seeded product id 5 (Limited Edition Hoodie)");
        assert.equal(hoodie.name, "Limited Edition Hoodie");
        assert.equal(hoodie.inventoryUnits, 3);
    });

    test("money fields are integer cents, never floats", async () => {
        server = await startTestServer();
        const { body } = await server.api("GET", "/products");

        for (const product of body) {
            assert.equal(Number.isInteger(product.priceCents), true);
        }
    });
});
