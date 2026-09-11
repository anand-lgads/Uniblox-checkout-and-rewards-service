export type OrderLineItem = {
    productId: number;
    name: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
};

export class Order {
    readonly id: string;
    readonly orderNumber: number;
    readonly cartId: string;
    readonly clientId: number;
    readonly items: OrderLineItem[];
    readonly grossCents: number;
    readonly discountCents: number;
    readonly netCents: number;
    readonly couponCode: string | null;
    readonly idempotencyKey: string;
    readonly placedAt: Date;

    constructor(params: {
        id: string;
        orderNumber: number;
        cartId: string;
        clientId: number;
        items: OrderLineItem[];
        grossCents: number;
        discountCents: number;
        netCents: number;
        couponCode: string | null;
        idempotencyKey: string;
        placedAt: Date;
    }) {
        this.id = params.id;
        this.orderNumber = params.orderNumber;
        this.cartId = params.cartId;
        this.clientId = params.clientId;
        this.items = params.items;
        this.grossCents = params.grossCents;
        this.discountCents = params.discountCents;
        this.netCents = params.netCents;
        this.couponCode = params.couponCode;
        this.idempotencyKey = params.idempotencyKey;
        this.placedAt = params.placedAt;
    }
}
