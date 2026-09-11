export class Product {
    id: number;
    name: string;
    priceCents: number;
    inventoryUnits: number;

    constructor(id: number, name: string, priceCents: number, inventoryUnits: number) {
        this.id = id;
        this.name = name;
        this.priceCents = priceCents;
        this.inventoryUnits = inventoryUnits;
    }
}
