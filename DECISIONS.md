# Decisions
## System invariants

These are the properties the system must never violate, regardless of retries, concurrency, or partial failures. Everything else in this document is in service of preserving these.

Inventory is never oversold. `product.inventoryUnits` never goes negative, and the sum of quantities across all completed orders for a product never exceeds what was ever available.
A cart is checked out at most once. Once `Cart.complete()` runs, the cart is immutable - no further item mutation, no second checkout.
Exactly one order per distinct checkout request. A checkout retried with the same `idempotencyKey` returns the original order; it never creates a second order or decrements inventory twice.
A coupon is redeemed at most once, and at most one coupon is minted per milestone. Both are enforced by deriving eligibility from existing records (`findByMilestone`, coupon status), never from a separate counter that could drift out of sync.
A coupon supplied on a checkout that ultimately fails is untouched. If any validation step fails (insufficient inventory, invalid product), the coupon must still be AVAILABLE afterward.
`netCents` is never negative. Guaranteed structurally (see Money below), not by a runtime clamp.
Report figures always reconcile with /orders and /admin/coupons. The report has no denormalized state of its own; it is recomputed from orders and coupons on every call, so it cannot drift, and repeated calls never mutate anything.
## Ambiguities and the semantics we chose

The spec deliberately leaves several behaviors unspecified. Here's what we picked and why.

Price/availability change between add-to-cart and checkout. A CartItem stores the price at the moment it was added, but this is display-only. `GET /carts/:id` re-prices every item against current product data and sets `pricesAndAvailabilityMayHaveChanged` when the live price or inventory no longer matches what's stored. Checkout re-validates and re-prices from current product data again, authoritatively - nothing from the cart's snapshot is ever charged. This means a customer always sees an accurate estimate, and the price they're actually charged is always live.
Quantity 0 on `PUT .../items/:productId` is treated as removal rather than a validation error, since "set to zero" and "remove" are the same customer intent.
Adding a product already in the cart merges quantities rather than creating a duplicate line item or rejecting the request.
Idempotency key scope is the request, not the cart. A replay is recognized purely by key match (`findByIdempotencyKey`), independent of the cart's current status. This is what lets a retry succeed with a replay even if, hypothetically, the cart's own state looked ambiguous.
Coupon generation is an explicit administrator action, never an automatic side effect of the Nth order succeeding. Eligible milestones can pile up (e.g. 3 milestones become eligible between admin calls); we mint them one at a time, strictly in order, on each call to /admin/coupons/generate, by finding the lowest un-rewarded milestone.
Coupon discount rounds down (floor), never up, and is computed against the order's `grossCents` at checkout time - not the cart's display subtotal - so a stale cart view can never mislead the discount math.
## Material design decisions
### Decision: Repository pattern + `UnitOfWork`, with a single `Db` interface as the storage seam

Context: The service needs to run on in-memory storage for this submission but be crediblely swappable to a production database without touching business logic.

**Options considered:**

- Have services call a storage layer directly (e.g. Maps or an ORM) inline.
- Repository interfaces per entity, with a general-purpose transaction abstraction.
- A full ORM/data-mapper framework.

Choice: `ProductRepository`, `CartRepository`, `OrderRepository`, `CouponRepository`, and `UnitOfWork` are interfaces (`repositeries/repositories.ts`). Every concrete backend (InMemory*, and a stubbed `postgresStore.ts`) implements the same shape, bundled behind one `Db` interface (`store/db.ts`) with a single initialize() lifecycle hook. `init.ts` is the only file that knows which concrete `Db` is active, selected via `DB_BACKEND`.

- Why: Services (`CartService`, `CouponService`, `ReportService`) are written entirely against interfaces. `UnitOfWork`.execute() maps directly to "in-memory: acquire a mutex" today and "real DB: `BEGIN/COMMIT/ ROLLBACK` with row locks" later - callers never change.

- Consequences: Adding Postgres later means implementing five classes in `postgresStore.ts` and adding one case to `init.ts`'s backend switch. Nothing in app.ts, the services, or the route handlers changes. The cost is a small amount of indirection for a project this size.

### Decision: Concurrency control via a single in-memory Mutex wrapping `UnitOfWork`.execute()

Context: Checkout and coupon generation both read-then-write across multiple entities (inventory, orders, coupons). Concurrent requests must not interleave their reads and writes.

**Options considered:**

- No locking, rely on JavaScript's single-threaded event loop and hope awaits don't interleave badly.
- Per-resource locking (e.g. a lock per product, per coupon milestone).
- One coarse-grained mutex serializing every execute() call process-wide.

Choice: One process-wide Mutex (`utils/mutex.ts`), shared by every InMemoryUnitOfWork instance a `Db` creates. Any execute() call - checkout or coupon generation - fully completes before the next one starts.

- Why: Node is single-threaded, but await points inside a checkout (multiple repository calls) are exactly where two concurrent requests could interleave and corrupt inventory or double-redeem a coupon. A single mutex is the simplest thing that provably prevents this, and is easy to reason about and test. Per-resource locking would allow more throughput (a checkout on product A doesn't need to block one on product B) but adds real complexity (lock ordering, deadlock avoidance) that isn't justified at this scale or timebox.

- Consequences: Checkout and coupon generation cannot run in parallel at all, even when they touch unrelated data - a throughput ceiling this design intentionally accepts. It also only holds within one process; see "Evolving to multiple instances" below.

### Decision: Idempotency via a required `idempotencyKey`, looked up before any mutation

Context: Clients may retry checkout after a timeout with no way to know whether the original request succeeded.

**Options considered:**

- No idempotency support; document that retries are the client's problem.
- Idempotency keyed on cart ID (only one checkout attempt per cart, ever).
- Idempotency keyed on an explicit client-supplied key, independent of cart state.

Choice: `idempotencyKey` is a required field on checkout. Inside `UnitOfWork`.execute(), the very first thing checkout does is look up orders.`findByIdempotencyKey`(key); if found, it returns that order immediately (replay: true, `HTTP 200`) without touching inventory, carts, or coupons again.

- Why: Keying on cart ID would conflate "this cart was already checked out" with "this specific request was already processed" - they're different failure modes. A client-supplied key lets a genuine retry of the same logical request be recognized even if, in some edge case, the cart's status is inspected out of order. Checking for replay before any other validation also means retries are cheap and never re-run business logic unnecessarily.

- Consequences: Clients must generate and persist their own idempotency key across a retry (e.g. a UUID stored before the first attempt) - this is a client-side contract we don't enforce beyond requiring the field be present.

### Decision: Money as integer cents everywhere; discounts always floor

Context: Floating-point arithmetic on currency is a classic source of off-by-a-cent bugs and non-deterministic totals.

**Options considered:**

- Floats with rounding at display time.
- A decimal/bignum library.
- Integer cents throughout, with explicit integer math for discounts.

Choice: Every money field (`priceCents`, `grossCents`, `discountCents`, `netCents`) is a plain integer. `percentDiscountCents()` computes `Math.floor((`grossCents` * percent)` / 100).

- Why: Integers avoid floating-point representation error entirely, and flooring the discount guarantees `discountCents` <= `grossCents` structurally - `netCents` = `grossCents` - `discountCents` can never go negative, so there's no separate "clamp to zero" branch to forget. This also makes discounts deterministic and reproducible from stored data alone.

- Consequences: A discount can leave up to 99 cents "on the table" per order due to flooring (e.g. 10% of a $0.01 item is $0.00, not fractional). We consider this the correct, boring choice for a customer-favorable rounding direction - never charging a customer more than the stated discount would imply.

### Decision: One error taxonomy (``AppError`` + `Errors` factory), not exceptions mapped ad hoc per route

Context: Different failures (validation, not-found, conflict) need distinguishable, useful error responses.

**Options considered:**

- Throw plain `Errors` and pattern-match messages in the HTTP layer.
- A different custom error class per failure type.
- One ``AppError`` class carrying a machine-readable code, an HTTP status, and optional structured details, constructed via named factory functions.

Choice: `errors.ts` defines one ``AppError`` class and an `Errors` object with one factory per failure case (`Errors`.cartNotFound(id), `Errors`.insufficientInventory(...), etc.). Every response body is { error: { code, message, details? } }. The Express error-handling middleware only needs to know if (err instanceof ``AppError``).

- Why: A stable code (e.g. INSUFFICIENT_INVENTORY) is what an API client should actually program against, not the human-readable message or the HTTP status alone (several failure modes share a status, e.g. 409 covers both CART_ALREADY_CHECKED_OUT and COUPON_ALREADY_REDEEMED). Centralizing construction means every error consistently carries the context needed to act on it (details), and adding a new error case never requires touching the HTTP layer.

- Consequences: Every thrown error in a service must be an ``AppError``; an accidental plain Error falls through to a generic 500, which is a deliberate fail-safe rather than a silent 200.

### Decision: Payment is not modeled - successful checkout is payment success

Context: The spec explicitly allows treating checkout as payment success, or adding a small fake payment abstraction.

**Options considered:**

- A PaymentGateway interface with a fake/no-op implementation, invoked during checkout.
- No payment abstraction at all; checkout committing is the terminal success state.

Choice: No payment abstraction. `CartService`.checkout() treats passing validation + committing the order as the complete definition of "successfully placed order."

- Why: A fake payment step that always succeeds adds a layer of indirection without adding any real behavior to reason about or test - it would be an interface with exactly one implementation that never fails, which doesn't demonstrate anything about how we'd handle payment failure, partial capture, or refunds. Given the timebox, we judged this better spent on inventory/coupon concurrency, which the spec weights more heavily. If payment were added for real, it would sit as its own step inside the same `UnitOfWork`.execute() block, before inventory is decremented - so a declined payment leaves inventory and the coupon untouched, the same guarantee we already have for other failure modes.

- Consequences: There is no simulated payment failure mode to test against. This is the most significant scope cut in the submission.

## Transaction, concurrency, and idempotency strategy (summary)

Every multi-step, invariant-critical operation - checkout and coupon generation - runs inside `UnitOfWork`.execute(). In-memory, this is a mutex; against a real database it becomes a transaction with row-level locking (see below). Within one execute() call:

Read and validate everything against current state first. No mutation happens until every check has passed.
Then commit every mutation together (inventory decrement, order save, coupon redemption, cart completion).

This ordering is what satisfies "a coupon must not be lost by a checkout that ultimately fails" - a coupon is only ever touched in step 2, after every other failure mode has already been ruled out.

Idempotency is checked as the very first thing inside execute(), before even cart lookup, so retries are cheap and never re-validate or re-commit anything.

## Money and rounding rules
All money fields are integer cents. Never floats, never strings.
Percentage discounts floor: `Math.floor(`grossCents` * percent / 100)`.
`netCents` = `grossCents` - `discountCents`, which is structurally guaranteed non-negative by the floor above.
An order's items snapshot its unitPriceCents/lineTotalCents at checkout time, so the order remains an accurate historical record even after the product's current price changes.
## Error model choices

See "Decision: One error taxonomy" above. Summary: every API error is { error: { code: string, message: string, details?: object } }, with a stable code clients can branch on, and details carrying whatever structured context that error type needs (e.g. { available, requested } for INSUFFICIENT_INVENTORY).

## What we implemented vs. intentionally deferred

**Implemented:**

Cart CRUD with live re-pricing and staleness detection
Checkout: idempotent, atomic, re-validates inventory/price at commit time, integer-cent money
Milestone-based coupon generation and single-use redemption
Admin report (pure read, reconciles from orders/coupons)
Concurrency safety for checkout-vs-checkout (oversell), checkout retries, coupon redemption races, and coupon generation races - all covered by tests using real concurrent (Promise.all) requests, not sequential happy-path calls

**Intentionally deferred:**

Real database backend. store/`postgresStore.ts` exists as a typed stub showing exactly where a Postgres implementation plugs in, but it is not implemented - out of scope for the timebox once the seam itself was built and demonstrated.
Payment integration/abstraction. See decision above.
`AuthN/AuthZ`. Explicitly out of scope per the spec; /admin/* routes are unauthenticated and documented as the operations we treat as administrative.
Pagination on `GET /products` and `GET /admin/coupons` - fine at seed-data scale, would matter in production.
Order cancellation/refunds - not in the required scope.
Checkout's own validation tests (CART_EMPTY, missing `idempotencyKey`, CART_ALREADY_CHECKED_OUT on a second real checkout) - the code paths exist and are exercised indirectly, but don't yet have dedicated tests.
Admin report tests - the endpoint exists and is manually verifiable, but has no automated reconciliation test yet.
## Evolving to multiple instances and a production database

The in-memory Mutex behind InMemoryUnitOfWork only guarantees serialized execution within one Node process. It does nothing across multiple instances behind a load balancer - two instances could still interleave and oversell.

The `Db`/repository seam exists specifically so this swap is localized:

store/`postgresStore.ts` would implement each repository against a real connection pool, and `PostgresUnitOfWork.execute()` would run BEGIN, execute work(), then COMMIT or ROLLBACK on throw - with `SELECT ... FOR UPDATE` on the specific product rows and the coupon milestone being touched, so the database's own lock manager (not in-process JavaScript) enforces serialization across every instance.
`init.ts`'s connectDb() gets one more case for `DB_BACKEND`=postgres; nothing else changes.
Idempotency would move from an in-memory Map lookup to a unique database constraint on `idempotencyKey`, so a duplicate insert fails at the database level even under true cross-instance concurrency, instead of relying on an in-process check-then-act.
Coupon milestone uniqueness would similarly become a unique constraint on milestone, rather than the current "loop until `findByMilestone` returns nothing" pattern, which is safe in-process only because the mutex serializes it.
Table/schema setup would come from migrations run ahead of deployment, not from application startup - `Db`.initialize() for a real backend is a no-op (or a connectivity check), never a reseed, since re-running seed data against production rows on every restart would be actively harmful.

## Use of AI

I used AI for most of my code generation work, and writing tests for the features, after the AI responds with a solution or code file, I try to figure out design flaws, future requirements etc and question the decision making by the AI and give suggestions for improvement.

Some examples of my AI usage prompts are this - 

* why is all this in server.ts, shouldnt this be in the implementation of inMemoryDB or some other file
* I want it simple, app.ts contains all routing logic, server.ts just starts the server, and some type of init that connects my app to the db - currently the inmemory db - and hence does the init of inMemory maps or whatver, so that later it is easy to replace the db by changing almost nothing
* this backend is essentially db right, why not just name it DB instead of backend
* can I do it this way, if I am connecting to inMemoryDb then I initiate dependencies, otherwise I assume that the tables in the production DB are already there
* I want to do it in separate files, use some interface
* why does my startTestServer directly call createInMemoryDb ? is it a good idea
