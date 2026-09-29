// Real step timings for the trace. Measured with a monotonic clock, rounded to 0.01 ms.
export const elapsed = (t0: number) => Math.round((performance.now() - t0) * 100) / 100;
export const mark = () => performance.now();
