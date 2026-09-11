import type { OrderRepository, CouponRepository } from "../repositeries/repositories.ts";

export type Report = {
    purchasedQuantityByProduct: Array<{ productId: number; name: string; quantity: number }>;
    grossRevenueCents: number;
    totalDiscountCents: number;
    netRevenueCents: number;
    coupons: { generated: number; available: number; redeemed: number };
    totalSuccessfulOrders: number;
};

// Pure read: every figure is derived directly from `orders` and `coupons`
// with no cached/denormalized counters of its own, so it can never drift
// out of sync with what the orders/coupons endpoints report. Repeated
// calls are side-effect free - no lock needed.
export class ReportService {
    private orders: OrderRepository;
    private coupons: CouponRepository;

    constructor(orders: OrderRepository, coupons: CouponRepository) {
        this.orders = orders;
        this.coupons = coupons;
    }

    async build(): Promise<Report> {
        const orders = await this.orders.list();
        const coupons = await this.coupons.list();

        const purchasedByProduct = new Map<number, { productId: number; name: string; quantity: number }>();
        let grossRevenueCents = 0;
        let totalDiscountCents = 0;

        for (const order of orders) {
            grossRevenueCents += order.grossCents;
            totalDiscountCents += order.discountCents;
            for (const item of order.items) {
                const existing = purchasedByProduct.get(item.productId) ?? {
                    productId: item.productId,
                    name: item.name,
                    quantity: 0,
                };
                existing.quantity += item.quantity;
                purchasedByProduct.set(item.productId, existing);
            }
        }

        const available = coupons.filter((c) => c.status === "AVAILABLE").length;
        const redeemed = coupons.filter((c) => c.status === "REDEEMED").length;

        return {
            purchasedQuantityByProduct: [...purchasedByProduct.values()],
            grossRevenueCents,
            totalDiscountCents,
            netRevenueCents: grossRevenueCents - totalDiscountCents,
            coupons: { generated: coupons.length, available, redeemed },
            totalSuccessfulOrders: orders.length,
        };
    }
}
