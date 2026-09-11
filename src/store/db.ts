import type {
    ProductRepository,
    CartRepository,
    OrderRepository,
    CouponRepository,
    UnitOfWork,
} from "../repositeries/repositories.ts";

// Every store implementation (in-memory today, a real DB later) hands
// back one of these. init.ts only ever talks to this shape - it never
// needs to know or care which concrete database is behind it.
export interface Db {
    products: ProductRepository;
    carts: CartRepository;
    orders: OrderRepository;
    coupons: CouponRepository;
    unitOfWork: UnitOfWork;

    // Whatever a DB needs before it can serve requests. For in-memory,
    // that's seeding demo data into empty Maps. For a real DB, that's
    // typically nothing - migrations already ran, and seeding real data
    // here would risk duplicating/stomping rows on every restart. Each
    // implementation decides for itself; init.ts just calls this and
    // moves on.
    initialize(): Promise<void>;
}
