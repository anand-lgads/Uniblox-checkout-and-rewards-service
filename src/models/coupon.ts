export type CouponStatus = "AVAILABLE" | "REDEEMED";

export class Coupon {
    readonly code: string;
    readonly discountPercent: number;
    // Which "Nth successful order" milestone this coupon rewards. Coupons
    // are generated one milestone at a time, in order - see
    // CouponService.generate(). This field is also what prevents
    // double-generation: at most one coupon may exist per milestone.
    readonly milestone: number;
    readonly createdAt: Date;
    status: CouponStatus;
    redeemedByOrderId: string | null;
    redeemedAt: Date | null;

    constructor(code: string, discountPercent: number, milestone: number, createdAt: Date) {
        this.code = code;
        this.discountPercent = discountPercent;
        this.milestone = milestone;
        this.createdAt = createdAt;
        this.status = "AVAILABLE";
        this.redeemedByOrderId = null;
        this.redeemedAt = null;
    }

    redeem(orderId: string, at: Date): void {
        if (this.status === "REDEEMED") throw new Error(`Coupon ${this.code} has already been redeemed`);
        this.status = "REDEEMED";
        this.redeemedByOrderId = orderId;
        this.redeemedAt = at;
    }
}
