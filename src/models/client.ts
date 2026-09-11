import { Cart } from "./cart.ts";

export class Client {
    id: number;
    name: string;
    carts: Cart[];
    numPurchases: number;
    constructor(id: number, name: string, email: string) {
        this.id = id;
        this.name = name;
        this.carts = [];
        this.numPurchases = 0;
    }
    // can add get completed carts, get all carts, etc. as needed
}
