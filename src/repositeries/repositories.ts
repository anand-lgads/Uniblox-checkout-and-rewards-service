import type { Product } from "../models/product.ts";
import type { Cart } from "../models/cart.ts";
import type { Order } from "../models/order.ts";
import type { Coupon } from "../models/coupon.ts";

export interface ProductRepository {
    findById(id: number): Promise<Product | undefined>;
    list(): Promise<Product[]>;
    save(product: Product): Promise<void>;
}

export interface CartRepository {
    findById(id: string): Promise<Cart | undefined>;
    save(cart: Cart): Promise<void>;
}

export interface OrderRepository {
    findById(id: string): Promise<Order | undefined>;
    // Backs idempotent retries: "have we already processed this exact
    // checkout request?" See CartService.checkout().
    findByIdempotencyKey(key: string): Promise<Order | undefined>;
    list(): Promise<Order[]>;
    count(): Promise<number>;
    save(order: Order): Promise<void>;
}

export interface CouponRepository {
    findByCode(code: string): Promise<Coupon | undefined>;
    // At most one coupon may exist per milestone - this is how
    // CouponService enforces "not already generated for that milestone"
    // without a separate counter that could drift from reality.
    findByMilestone(milestone: number): Promise<Coupon | undefined>;
    list(): Promise<Coupon[]>;
    save(coupon: Coupon): Promise<void>;
}

// Every multi-step, invariant-critical operation (checkout, coupon
// generation) runs inside UnitOfWork.execute(). In-memory, this is a
// mutex. Against a real DB it becomes BEGIN ... COMMIT / ROLLBACK
// (with SELECT ... FOR UPDATE on the rows being touched). Either way,
// callers never observe a partially-applied operation, and services never
// need to change when the backend does.
export interface UnitOfWork {
    execute<T>(work: () => Promise<T>): Promise<T>;
}
