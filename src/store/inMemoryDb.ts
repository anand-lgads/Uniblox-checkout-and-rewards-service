import { Client } from "../models/client.ts";
import { Product } from "../models/product.ts";
import { Cart } from "../models/cart.ts";

export class InMemoryDB {
    private clients: Map<number, Client>;
    private products: Map<number, Product>;
    private carts: Map<number, Cart>;

    constructor() {
        this.clients = new Map();
        this.products = new Map();
        this.carts = new Map();
    }

    // --------------------
    // Clients
    // --------------------

    getClient(clientId: number): Client | undefined {
        return this.clients.get(clientId);
    }

    saveClient(client: Client): void {
        this.clients.set(client.id, client);
    }

    // --------------------
    // Products
    // --------------------

    getProduct(productId: number): Product | undefined {
        return this.products.get(productId);
    }

    saveProduct(product: Product): void {
        this.products.set(product.id, product);
    }

    // --------------------
    // Carts
    // --------------------

    getCart(cartId: number): Cart | undefined {
        return this.carts.get(cartId);
    }

    // saveCart(cart: Cart): void {
    //     this.carts.set(cart.cartId, cart);
    // }

    getCartsByClient(clientId: number): Cart[] {
        return Array.from(this.carts.values()).filter(
            cart => cart.clientId === clientId
        );
    }
}
