Store product object in cart vs not storing
- the cart wants to keep a state, price of item when added - not a good idea to store product in cartItem because Product represent the current catalog, cart wants to preserve state from when item was added.


Cart owns cart state.
CartItem owns quantity + price snapshot.
Product owns current product state.
ProductRepository/Service retrieves the current product.
CartService coordinates cart + product operations.
Checkout revalidates current inventory and price.

