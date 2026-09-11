import express, {
    type Request,
    type Response,
    type NextFunction,
} from "express";

import { AppError, Errors } from "./errors.ts";

import type { CartService } from "./services/cartService.ts";
import type { CouponService } from "./services/couponService.ts";
import type { ReportService } from "./services/reportService.ts";
import type {
    ProductRepository,
    OrderRepository,
} from "./repositeries/repositories.ts";

export function createApp(deps: {
    products: ProductRepository;
    orders: OrderRepository;
    cartService: CartService;
    couponService: CouponService;
    reportService: ReportService;
}) {
    const {
        products,
        orders,
        cartService,
        couponService,
        reportService,
    } = deps;

    const app = express();

    // Parse JSON request bodies
    app.use(express.json());

    // --------------------------------------------------
    // Products
    // --------------------------------------------------

    app.get("/products", async (_req, res, next) => {
        try {
            const result = await products.list();
            res.status(200).json(result);
        } catch (err) {
            next(err);
        }
    });

    // --------------------------------------------------
    // Carts
    // --------------------------------------------------

    app.post("/carts", async (req, res, next) => {
        try {
            const clientId =
                typeof req.body.clientId === "number"
                    ? req.body.clientId
                    : 1;

            const cart = await cartService.createCart(clientId);

            const result = await cartService.viewCart(cart.cartId);

            res.status(201).json(result);
        } catch (err) {
            next(err);
        }
    });

    app.get("/carts/:cartId", async (req, res, next) => {
        try {
            const result = await cartService.viewCart(req.params.cartId);

            res.status(200).json(result);
        } catch (err) {
            next(err);
        }
    });

    app.post("/carts/:cartId/items", async (req, res, next) => {
        try {
            const { productId, quantity } = req.body;

            if (typeof productId !== "number") {
                throw Errors.validation(
                    "productId is required and must be a number",
                    { field: "productId" }
                );
            }

            const result = await cartService.addItem(
                req.params.cartId,
                productId,
                quantity
            );

            res.status(201).json(result);
        } catch (err) {
            next(err);
        }
    });

    app.put(
        "/carts/:cartId/items/:productId",
        async (req, res, next) => {
            try {
                const result = await cartService.updateItem(
                    req.params.cartId,
                    Number(req.params.productId),
                    req.body.quantity
                );

                res.status(200).json(result);
            } catch (err) {
                next(err);
            }
        }
    );

    app.delete(
        "/carts/:cartId/items/:productId",
        async (req, res, next) => {
            try {
                const result = await cartService.removeItem(
                    req.params.cartId,
                    Number(req.params.productId)
                );

                res.status(200).json(result);
            } catch (err) {
                next(err);
            }
        }
    );

    // --------------------------------------------------
    // Checkout
    // --------------------------------------------------

    app.post(
        "/carts/:cartId/checkout",
        async (req, res, next) => {
            try {
                const { order, replay } = await cartService.checkout(
                    req.params.cartId,
                    req.body.idempotencyKey,
                    req.body.couponCode ?? null
                );

                res.status(replay ? 200 : 201).json({
                    ...order,
                    idempotentReplay: replay,
                });
            } catch (err) {
                next(err);
            }
        }
    );

    // --------------------------------------------------
    // Orders
    // --------------------------------------------------

    app.get("/orders/:orderId", async (req, res, next) => {
        try {
            const order = await orders.findById(req.params.orderId);

            if (!order) {
                throw Errors.orderNotFound(req.params.orderId);
            }

            res.status(200).json(order);
        } catch (err) {
            next(err);
        }
    });

    // --------------------------------------------------
    // Admin
    // --------------------------------------------------

    app.post(
        "/admin/coupons/generate",
        async (_req, res, next) => {
            try {
                const result = await couponService.generate();

                res.status(201).json(result);
            } catch (err) {
                next(err);
            }
        }
    );

    app.get(
        "/admin/coupons",
        async (_req, res, next) => {
            try {
                const result = await couponService.list();

                res.status(200).json(result);
            } catch (err) {
                next(err);
            }
        }
    );

    app.get(
        "/admin/report",
        async (_req, res, next) => {
            try {
                const result = await reportService.build();

                res.status(200).json(result);
            } catch (err) {
                next(err);
            }
        }
    );

    // --------------------------------------------------
    // 404 handler
    // --------------------------------------------------

    app.use((_req, _res, next) => {
        next(Errors.routeNotFound());
    });

    // --------------------------------------------------
    // Error handler
    // --------------------------------------------------

    app.use(
        (
            err: unknown,
            _req: Request,
            res: Response,
            _next: NextFunction
        ) => {
            if (err instanceof AppError) {
                return res.status(err.status).json(err.toJSON());
            }

            console.error("Unhandled error:", err);

            return res
                .status(500)
                .json(Errors.internal().toJSON());
        }
    );

    return app;
}
