import { Product } from "./models/product.ts";
import type { ProductRepository } from "./repositeries/repositories.ts";

export async function seed(products: ProductRepository): Promise<void> {
    const seedData = [
        new Product(1, "Ceramic Mug", 1299, 50),
        new Product(2, "Dot-Grid Notebook", 899, 100),
        new Product(3, "Gel Pen (Black)", 249, 200),
        new Product(4, "Canvas Tote Bag", 1999, 30),
        // Limited-inventory product - exercises oversell / concurrency behavior.
        new Product(5, "Limited Edition Hoodie", 5999, 3),
    ];
    for (const product of seedData) {
        await products.save(product);
    }
}
