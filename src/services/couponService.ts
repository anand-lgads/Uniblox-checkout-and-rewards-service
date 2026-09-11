import type { CouponRepository, OrderRepository, UnitOfWork } from "../repositeries/repositories.ts";
import { Coupon } from "../models/coupon.ts";
import { Errors } from "../errors.ts";

// DECISION: coupon generation is an explicit administrator action, never
// an automatic side-effect of the Nth checkout succeeding. The milestone
// (successfulOrderCount / n) can become eligible at any moment due to
// concurrent checkouts, but a coupon is only minted when an admin asks -
// and at most one coupon is ever minted per milestone. See DECISIONS.md.
export class CouponService {
    private coupons: CouponRepository;
    private orders: OrderRepository;
    private unitOfWork: UnitOfWork;
    private milestoneN: number;
    private discountPercent: number;

    constructor(
        coupons: CouponRepository,
        orders: OrderRepository,
        unitOfWork: UnitOfWork,
        milestoneN: number,
        discountPercent: number
    ) {
        this.coupons = coupons;
        this.orders = orders;
        this.unitOfWork = unitOfWork;
        this.milestoneN = milestoneN;
        this.discountPercent = discountPercent;
    }

    async generate(): Promise<Coupon> {
        return this.unitOfWork.execute(async () => {
            const successfulOrderCount = await this.orders.count();
            const currentMilestone = Math.floor(successfulOrderCount / this.milestoneN);

            // Milestones are minted strictly in order, one per admin call,
            // by finding the smallest un-rewarded milestone. This also
            // means "already generated for that milestone" can never
            // desync from reality: it's derived from the coupons table
            // itself (findByMilestone), not a separate counter.
            let nextMilestone = 1;
            while (await this.coupons.findByMilestone(nextMilestone)) {
                nextMilestone += 1;
            }

            if (nextMilestone > currentMilestone) {
                throw Errors.noEligibleMilestone(successfulOrderCount, this.milestoneN, nextMilestone);
            }

            const code = `SAVE${this.discountPercent}-M${nextMilestone}`;
            const coupon = new Coupon(code, this.discountPercent, nextMilestone, new Date());
            await this.coupons.save(coupon);
            return coupon;
        });
    }

    async list(): Promise<Coupon[]> {
        return this.coupons.list();
    }
}
