export class Product {
    id: number;
    name: string;
    price: number;
    inventoryUnits: number;
    constructor(id: number, name: string, price: number, inventoryUnits: number) {
        this.id = id;
        this.name = name;
        this.price = price;
        this.inventoryUnits = inventoryUnits;
    }
}