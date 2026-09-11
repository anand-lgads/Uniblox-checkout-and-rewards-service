export type CartStatus = "ACTIVE" | "COMPLETED";

export type CartItem = {
    productId: number;
    quantity: number;
    priceCents: number; // last-known price, display-only - see CartService.checkout
};

export class Cart {
    readonly cartId: string;
    readonly clientId: number;

    private cartItems: CartItem[];
    private status: CartStatus;
    // Set once, when checkout() commits. Lets a cart point back at the
    // order it produced without needing a reverse lookup.
    orderId: string | null;

    private constructor(cartId: string, clientId: number) {
        this.cartId = cartId;
        this.clientId = clientId;
        this.cartItems = [];
        this.status = "ACTIVE";
        this.orderId = null;
    }

    static createNewCart(cartId: string, clientId: number): Cart {
        return new Cart(cartId, clientId);
    }

    getStatus(): CartStatus {
        return this.status;
    }

    getItems(): CartItem[] {
        return this.cartItems;
    }

    addProduct(productId: number, quantity: number, priceCents: number): void {
        this.ensureActive();
        this.validateQuantity(quantity);

        const existingItem = this.cartItems.find((item) => item.productId === productId);
        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            this.cartItems.push({ productId, quantity, priceCents });
        }
    }

    // quantity === 0 is treated as removal - see CartService.updateItem.
    setQuantity(productId: number, quantity: number): void {
        this.ensureActive();
        if (quantity < 0 || !Number.isInteger(quantity)) {
            throw new Error("Quantity must be a non-negative integer");
        }
        const existingItem = this.cartItems.find((item) => item.productId === productId);
        if (!existingItem) throw new Error("Product is not in the cart");

        if (quantity === 0) {
            this.cartItems = this.cartItems.filter((item) => item.productId !== productId);
        } else {
            existingItem.quantity = quantity;
        }
    }

    removeItem(productId: number): void {
        this.ensureActive();
        const index = this.cartItems.findIndex((item) => item.productId === productId);
        if (index === -1) throw new Error("Product is not in the cart");
        this.cartItems.splice(index, 1);
    }

    getDisplaySubtotalCents(): number {
        // Display-only estimate for GET /carts/:id. The authoritative total
        // is computed fresh from current product data in
        // CartService.checkout() - nothing here is ever charged.
        return this.cartItems.reduce((total, item) => total + item.priceCents * item.quantity, 0);
    }

    complete(orderId: string): void {
        if (this.status === "COMPLETED") throw new Error("Cart has already been checked out");
        if (this.cartItems.length === 0) throw new Error("Cannot checkout an empty cart");
        this.status = "COMPLETED";
        this.orderId = orderId;
    }

    private ensureActive(): void {
        if (this.status === "COMPLETED") throw new Error("Cannot modify a completed cart");
    }

    private validateQuantity(quantity: number): void {
        if (quantity <= 0 || !Number.isInteger(quantity)) {
            throw new Error("Quantity must be a positive integer");
        }
    }
}
