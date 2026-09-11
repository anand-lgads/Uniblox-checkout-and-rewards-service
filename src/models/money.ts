// All money is integer cents. Floats never enter a calculation - only at
// the very edge (e.g. formatting for a human) would you convert, and this
// project never needs to.

export function isNonNegativeInteger(n: unknown): n is number {
    return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

export function isPositiveInteger(n: unknown): n is number {
    return typeof n === "number" && Number.isInteger(n) && n > 0;
}

// Percentage discount computed with integer math, floored. Flooring
// guarantees discountCents <= grossCents always, which is what guarantees
// netCents can never go negative - no separate "clamp to zero" needed.
export function percentDiscountCents(grossCents: number, percent: number): number {
    if (!isNonNegativeInteger(grossCents)) {
        throw new TypeError("grossCents must be a non-negative integer");
    }
    if (!isNonNegativeInteger(percent) || percent > 100) {
        throw new TypeError("percent must be an integer between 0 and 100");
    }
    return Math.floor((grossCents * percent) / 100);
}
