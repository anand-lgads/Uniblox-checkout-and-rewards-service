// Node is single-threaded, so races only arise from interleaving across
// `await` points. Wrapping a critical section (checkout, coupon
// generation) in this mutex guarantees only one such section's body runs
// at a time within this process - enough to preserve invariants for a
// single instance. It does NOT help across multiple processes; see
// DECISIONS.md for how this maps to a real DB transaction.
export class Mutex {
    private locked = false;
    private queue: Array<() => void> = [];

    acquire(): Promise<() => void> {
        return new Promise((resolve) => {
            const tryAcquire = () => {
                if (!this.locked) {
                    this.locked = true;
                    resolve(() => this.release());
                } else {
                    this.queue.push(tryAcquire);
                }
            };
            tryAcquire();
        });
    }

    private release(): void {
        this.locked = false;
        const next = this.queue.shift();
        if (next) next();
    }
}
