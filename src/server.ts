import { createApp } from "./app.ts";
import { initDependencies } from "./init.ts";

const MILESTONE_N = Number(process.env.MILESTONE_N) || 5;
const MILESTONE_DISCOUNT_PERCENT =
    Number(process.env.MILESTONE_DISCOUNT_PERCENT) || 10;

const deps = await initDependencies({
    milestoneN: MILESTONE_N,
    discountPercent: MILESTONE_DISCOUNT_PERCENT,
});

const app = createApp(deps);

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
    console.log(`Checkout & rewards service listening on http://localhost:${PORT}`);
    console.log(
        `Coupon milestone: every ${MILESTONE_N}th order unlocks ${MILESTONE_DISCOUNT_PERCENT}% off`
    );
});
