import { Product } from "./product";

class CartItem {
    product: Product;
    quantity: number;
    constructor(product: Product, quantity: number) {
        this.product = product;
        this.quantity = quantity;
    }
}

class Cart {
    clientId: number;
    cartItems: CartItem[];
    private constructor(clientId: number) {
        this.clientId = clientId;
        this.cartItems = [];
    }

    createNewCart(clientId: number): Cart {
        return new Cart(clientId);
    }

    addProduct(product: Product, quantity: number): void {
        // Validate quantity
        if (quantity <= 0 || !Number.isInteger(quantity)) {
            throw new Error("Quantity must be a positive integer");
        }

        // Validate product
        if (!product) {
            throw new Error("Invalid product");
        }

        // Check inventory
        const existingItem = this.cartItems.find(
            item => item.product.id === product.id
        );

        const currentQuantity = existingItem?.quantity ?? 0;
        const newQuantity = currentQuantity + quantity;

        if (newQuantity > product.inventoryUnits) {
            throw new Error(
                `Not enough inventory for ${product.name}. Available: ${product.inventoryUnits}`
            );
        }

        // Add or update cart item
        if (existingItem) {
            existingItem.quantity = newQuantity;
        } else {
            this.cartItems.push({
                product,
                quantity
            });
        }
    }

    removeItem(productId: number, quantity: number): void {
        if (quantity <= 0 || !Number.isInteger(quantity)) {
            throw new Error("Quantity must be a positive integer");
        }

        const index = this.cartItems.findIndex(
            item => item.product.id === productId
        );

        if (index === -1) {
            throw new Error("Product is not in the cart");
        }

        const item = this.cartItems[index];

        if (quantity >= item.quantity) {
            this.cartItems.splice(index, 1);
        } else {
            item.quantity -= quantity;
        }
    }

    getCart(): CartItem[] {
        return this.cartItems;
    }
}