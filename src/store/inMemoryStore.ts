import type { Product } from "../models/product.ts";
import type { Cart } from "../models/cart.ts";
import type { Order } from "../models/order.ts";
import type { Coupon } from "../models/coupon.ts";
import type {
    ProductRepository,
    CartRepository,
    OrderRepository,
    CouponRepository,
    UnitOfWork,
} from "../repositeries/repositories.ts";
import type { Db } from "./db.ts";
import { Mutex } from "../utils/mutex.ts";
import { seed } from "../seed.ts";

// Shared "tables". Each repository below is a thin facade over these
// Maps - mirroring how a real repository is usually a thin facade over a
// shared DB connection pool. Splitting tables / repositories / transaction
// into separate pieces is what makes each one swappable independently.
function createTables() {
    return {
        products: new Map<number, Product>(),
        carts: new Map<string, Cart>(),
        orders: new Map<string, Order>(),
        ordersByIdempotencyKey: new Map<string, string>(), // idempotencyKey -> orderId
        coupons: new Map<string, Coupon>(),
        couponsByMilestone: new Map<number, string>(), // milestone -> code
    };
}
export type Tables = ReturnType<typeof createTables>;

export class InMemoryProductRepository implements ProductRepository {
    private tables: Tables;
    constructor(tables: Tables) {
        this.tables = tables;
    }
    async findById(id: number): Promise<Product | undefined> {
        return this.tables.products.get(id);
    }
    async list(): Promise<Product[]> {
        return [...this.tables.products.values()];
    }
    async save(product: Product): Promise<void> {
        this.tables.products.set(product.id, product);
    }
}

export class InMemoryCartRepository implements CartRepository {
    private tables: Tables;
    constructor(tables: Tables) {
        this.tables = tables;
    }
    async findById(id: string): Promise<Cart | undefined> {
        return this.tables.carts.get(id);
    }
    async save(cart: Cart): Promise<void> {
        this.tables.carts.set(cart.cartId, cart);
    }
}

export class InMemoryOrderRepository implements OrderRepository {
    private tables: Tables;
    constructor(tables: Tables) {
        this.tables = tables;
    }
    async findById(id: string): Promise<Order | undefined> {
        return this.tables.orders.get(id);
    }
    async findByIdempotencyKey(key: string): Promise<Order | undefined> {
        const orderId = this.tables.ordersByIdempotencyKey.get(key);
        return orderId ? this.tables.orders.get(orderId) : undefined;
    }
    async list(): Promise<Order[]> {
        return [...this.tables.orders.values()];
    }
    async count(): Promise<number> {
        return this.tables.orders.size;
    }
    async save(order: Order): Promise<void> {
        this.tables.orders.set(order.id, order);
        this.tables.ordersByIdempotencyKey.set(order.idempotencyKey, order.id);
    }
}

export class InMemoryCouponRepository implements CouponRepository {
    private tables: Tables;
    constructor(tables: Tables) {
        this.tables = tables;
    }
    async findByCode(code: string): Promise<Coupon | undefined> {
        return this.tables.coupons.get(code);
    }
    async findByMilestone(milestone: number): Promise<Coupon | undefined> {
        const code = this.tables.couponsByMilestone.get(milestone);
        return code ? this.tables.coupons.get(code) : undefined;
    }
    async list(): Promise<Coupon[]> {
        return [...this.tables.coupons.values()];
    }
    async save(coupon: Coupon): Promise<void> {
        this.tables.coupons.set(coupon.code, coupon);
        this.tables.couponsByMilestone.set(coupon.milestone, coupon.code);
    }
}

// In-memory stand-in for a DB transaction: serializes execute() calls so
// two concurrent checkouts (or a checkout racing a coupon generation)
// can never interleave their reads and writes. A real implementation
// would open a client, `BEGIN`, run `work`, then `COMMIT` or `ROLLBACK`
// on throw - callers would not need to change at all.

export class InMemoryUnitOfWork implements UnitOfWork {
    private mutex = new Mutex();
    async execute<T>(work: () => Promise<T>): Promise<T> {
        const release = await this.mutex.acquire();
        try {
            return await work();
        } finally {
            release();
        }
    }
}

export function createInMemoryDb(): Db {
    const tables = createTables();
    const products = new InMemoryProductRepository(tables);

    return {
        products,
        carts: new InMemoryCartRepository(tables),
        orders: new InMemoryOrderRepository(tables),
        coupons: new InMemoryCouponRepository(tables),
        unitOfWork: new InMemoryUnitOfWork(),

        // In-memory tables live only in process memory, so they start
        // empty on every boot - seeding here is what makes "npm start"
        // usable at all.
        async initialize() {
            await seed(products);
        },
    };
}
