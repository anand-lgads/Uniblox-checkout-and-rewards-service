// One error type, one taxonomy. Every error the API can return has a
// stable machine-readable `code`, an HTTP `status`, a message, and
// optional `details`. The HTTP layer never has to guess a status code
// from a generic Error - it only has to know how to render an AppError.

export class AppError extends Error {
    readonly code: string;
    readonly status: number;
    readonly details?: unknown;

    constructor(code: string, status: number, message: string, details?: unknown) {
        super(message);
        this.name = "AppError";
        this.code = code;
        this.status = status;
        this.details = details;
    }

    toJSON() {
        const body: Record<string, unknown> = { error: { code: this.code, message: this.message } };
        if (this.details !== undefined) {
            (body.error as Record<string, unknown>).details = this.details;
        }
        return body;
    }
}

export const Errors = {
    validation: (message: string, details?: unknown) => new AppError("VALIDATION_ERROR", 400, message, details),

    productNotFound: (productId: number) =>
        new AppError("PRODUCT_NOT_FOUND", 404, `Product ${productId} does not exist`, { productId }),

    cartNotFound: (cartId: string) =>
        new AppError("CART_NOT_FOUND", 404, `Cart ${cartId} does not exist`, { cartId }),

    cartItemNotFound: (cartId: string, productId: number) =>
        new AppError("CART_ITEM_NOT_FOUND", 404, `Product ${productId} is not in cart ${cartId}`, {
            cartId,
            productId,
        }),

    cartAlreadyCheckedOut: (cartId: string) =>
        new AppError("CART_ALREADY_CHECKED_OUT", 409, `Cart ${cartId} has already been checked out`, { cartId }),

    cartEmpty: (cartId: string) => new AppError("CART_EMPTY", 400, `Cart ${cartId} has no items`, { cartId }),

    insufficientInventory: (productId: number, requested: number, available: number) =>
        new AppError(
            "INSUFFICIENT_INVENTORY",
            409,
            `Only ${available} unit(s) of product ${productId} are available, ${requested} requested`,
            { productId, requested, available }
        ),

    idempotencyKeyRequired: () =>
        new AppError("IDEMPOTENCY_KEY_REQUIRED", 400, "A checkout request requires an idempotencyKey"),

    orderNotFound: (orderId: string) =>
        new AppError("ORDER_NOT_FOUND", 404, `Order ${orderId} does not exist`, { orderId }),

    couponInvalid: (couponCode: string) =>
        new AppError("COUPON_INVALID", 400, `Coupon ${couponCode} does not exist or is invalid`, { couponCode }),

    couponAlreadyRedeemed: (couponCode: string) =>
        new AppError("COUPON_ALREADY_REDEEMED", 409, `Coupon ${couponCode} has already been redeemed`, {
            couponCode,
        }),

    noEligibleMilestone: (successfulOrderCount: number, n: number, nextMilestone: number) =>
        new AppError(
            "NO_ELIGIBLE_MILESTONE",
            409,
            `No new milestone reached yet. ${successfulOrderCount} successful order(s) so far, ` +
                `next coupon unlocks at order ${nextMilestone * n}`,
            { successfulOrderCount, n, nextMilestone }
        ),

    routeNotFound: () => new AppError("ROUTE_NOT_FOUND", 404, "No such route"),

    internal: (message = "Unexpected server error") => new AppError("INTERNAL_ERROR", 500, message),
};
