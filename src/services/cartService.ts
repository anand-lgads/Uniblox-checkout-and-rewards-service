import { randomUUID } from "node:crypto";
import type { ProductRepository, CartRepository, OrderRepository, CouponRepository, UnitOfWork } from "../repositeries/repositories.ts";
import { Order } from "../models/order.ts";
import type { OrderLineItem } from "../models/order.ts";
import { Cart } from "../models/cart.ts";
import { Errors } from "../errors.ts";
import { isPositiveInteger, isNonNegativeInteger, percentDiscountCents } from "../models/money.ts";

export type CartView = {
    id: string;
    status: string;
    items: Array<{
        productId: number;
        name: string;
        quantity: number;
        unitPriceCents: number;
        lineTotalCents: number;
        availableInventory: number;
        sufficientInventory: boolean;
    }>;
    subtotalCents: number;
    orderId: string | null;
    pricesAndAvailabilityMayHaveChanged: boolean;
};

export class CartService {
    private products: ProductRepository;
    private carts: CartRepository;
    private orders: OrderRepository;
    private coupons: CouponRepository;
    private unitOfWork: UnitOfWork;
    private orderSeq = 0; // display-only order numbering; see DECISIONS.md

    constructor(
        products: ProductRepository,
        carts: CartRepository,
        orders: OrderRepository,
        coupons: CouponRepository,
        unitOfWork: UnitOfWork
    ) {
        this.products = products;
        this.carts = carts;
        this.orders = orders;
        this.coupons = coupons;
        this.unitOfWork = unitOfWork;
    }

    async createCart(clientId: number): Promise<Cart> {
        const cart = Cart.createNewCart(randomUUID(), clientId);
        await this.carts.save(cart);
        return cart;
    }

    async addItem(cartId: string, productId: number, quantity: unknown): Promise<CartView> {
        const cart = await this.getCartOrThrow(cartId);
        const product = await this.getProductOrThrow(productId);
        if (!isPositiveInteger(quantity)) {
            throw Errors.validation("quantity must be a positive integer", { quantity });
        }
        const existing = cart.getItems().find((i) => i.productId === productId);
        const prospectiveQty = (existing?.quantity ?? 0) + quantity;
        // Soft check at add-time, for a fast client-side error. The
        // authoritative check happens again at checkout - see
        // CartService.checkout() and DECISIONS.md.
        if (prospectiveQty > product.inventoryUnits) {
            throw Errors.insufficientInventory(productId, prospectiveQty, product.inventoryUnits);
        }
        cart.addProduct(productId, quantity, product.priceCents);
        await this.carts.save(cart);
        return this.view(cart);
    }

    async updateItem(cartId: string, productId: number, quantity: unknown): Promise<CartView> {
        const cart = await this.getCartOrThrow(cartId);
        const product = await this.getProductOrThrow(productId);
        if (!isNonNegativeInteger(quantity)) {
            throw Errors.validation("quantity must be a non-negative integer", { quantity });
        }
        if (!cart.getItems().some((i) => i.productId === productId)) {
            throw Errors.cartItemNotFound(cartId, productId);
        }
        if (quantity > product.inventoryUnits) {
            throw Errors.insufficientInventory(productId, quantity, product.inventoryUnits);
        }
        cart.setQuantity(productId, quantity);
        await this.carts.save(cart);
        return this.view(cart);
    }

    async removeItem(cartId: string, productId: number): Promise<CartView> {
        const cart = await this.getCartOrThrow(cartId);
        if (!cart.getItems().some((i) => i.productId === productId)) {
            throw Errors.cartItemNotFound(cartId, productId);
        }
        cart.removeItem(productId);
        await this.carts.save(cart);
        return this.view(cart);
    }

    async viewCart(cartId: string): Promise<CartView> {
        const cart = await this.carts.findById(cartId);
        if (!cart) throw Errors.cartNotFound(cartId);
        return this.view(cart);
    }

    // idempotencyKey is required: it is how a client-side retry (timeout,
    // dropped response) is distinguished from a genuinely new checkout
    // request. Everything below runs inside one UnitOfWork.execute() call,
    // so - regardless of backend - it either fully commits or fully does
    // not, and no other checkout or coupon generation can interleave with
    // it. See DECISIONS.md "Transaction & concurrency strategy".
    async checkout(
        cartId: string,
        idempotencyKey: string,
        couponCode: string | null
    ): Promise<{ order: Order; replay: boolean }> {
        if (!idempotencyKey || typeof idempotencyKey !== "string") {
            throw Errors.idempotencyKeyRequired();
        }

        return this.unitOfWork.execute(async () => {
            // Replay check is keyed on the request, not on cart state. This
            // is what lets a retry return the *original* order instead of
            // just failing with "already checked out".
            const existingOrder = await this.orders.findByIdempotencyKey(idempotencyKey);
            if (existingOrder) return { order: existingOrder, replay: true };

            const cart = await this.carts.findById(cartId);
            if (!cart) throw Errors.cartNotFound(cartId);
            if (cart.getStatus() === "COMPLETED") throw Errors.cartAlreadyCheckedOut(cartId);
            if (cart.getItems().length === 0) throw Errors.cartEmpty(cartId);

            // --- Validate everything against CURRENT data first. No
            // mutation happens until every check below has passed, so a
            // failure here leaves inventory, the cart, and any coupon
            // completely untouched.
            const lineItems: OrderLineItem[] = [];
            let grossCents = 0;
            for (const item of cart.getItems()) {
                const product = await this.products.findById(item.productId);
                if (!product) throw Errors.productNotFound(item.productId);
                if (item.quantity > product.inventoryUnits) {
                    throw Errors.insufficientInventory(item.productId, item.quantity, product.inventoryUnits);
                }
                const lineTotalCents = product.priceCents * item.quantity;
                grossCents += lineTotalCents;
                lineItems.push({
                    productId: product.id,
                    name: product.name,
                    quantity: item.quantity,
                    unitPriceCents: product.priceCents,
                    lineTotalCents,
                });
            }

            let discountCents = 0;
            const coupon = couponCode ? await this.coupons.findByCode(couponCode) : undefined;
            if (couponCode) {
                if (!coupon) throw Errors.couponInvalid(couponCode);
                if (coupon.status !== "AVAILABLE") throw Errors.couponAlreadyRedeemed(couponCode);
                discountCents = percentDiscountCents(grossCents, coupon.discountPercent);
            }
            const netCents = grossCents - discountCents; // always >= 0, see money.ts

            // --- All validated. Commit every mutation together. ---
            for (const item of lineItems) {
                const product = await this.products.findById(item.productId);
                product!.inventoryUnits -= item.quantity;
                await this.products.save(product!);
            }

            this.orderSeq += 1;
            const order = new Order({
                id: randomUUID(),
                orderNumber: this.orderSeq,
                cartId: cart.cartId,
                clientId: cart.clientId,
                items: lineItems,
                grossCents,
                discountCents,
                netCents,
                couponCode: coupon ? coupon.code : null,
                idempotencyKey,
                placedAt: new Date(),
            });
            await this.orders.save(order);

            if (coupon) {
                coupon.redeem(order.id, order.placedAt);
                await this.coupons.save(coupon);
            }

            cart.complete(order.id);
            await this.carts.save(cart);

            return { order, replay: false };
        });
    }

    private async getCartOrThrow(cartId: string): Promise<Cart> {
        const cart = await this.carts.findById(cartId);
        if (!cart) throw Errors.cartNotFound(cartId);
        if (cart.getStatus() === "COMPLETED") throw Errors.cartAlreadyCheckedOut(cartId);
        return cart;
    }

    private async getProductOrThrow(productId: number) {
        const product = await this.products.findById(productId);
        if (!product) throw Errors.productNotFound(productId);
        return product;
    }

    // Builds a client-facing preview of the cart, re-priced against
    // *current* product data. This is explicitly a preview: the
    // authoritative price and inventory check happens again at checkout
    // time (see checkout() above and DECISIONS.md "Price snapshot timing").
    private async view(cart: Cart): Promise<CartView> {
        const items: CartView["items"] = [];
        let subtotalCents = 0;
        let pricesAndAvailabilityMayHaveChanged = false;

        for (const item of cart.getItems()) {
            const product = await this.products.findById(item.productId);
            if (!product) {
                pricesAndAvailabilityMayHaveChanged = true;
                continue;
            }
            const lineTotalCents = product.priceCents * item.quantity;
            subtotalCents += lineTotalCents;
            const sufficientInventory = product.inventoryUnits >= item.quantity;
            if (!sufficientInventory || product.priceCents !== item.priceCents) {
                pricesAndAvailabilityMayHaveChanged = true;
            }
            items.push({
                productId: item.productId,
                name: product.name,
                quantity: item.quantity,
                unitPriceCents: product.priceCents,
                lineTotalCents,
                availableInventory: product.inventoryUnits,
                sufficientInventory,
            });
        }

        return {
            id: cart.cartId,
            status: cart.getStatus(),
            items,
            subtotalCents,
            orderId: cart.orderId,
            pricesAndAvailabilityMayHaveChanged,
        };
    }
}
