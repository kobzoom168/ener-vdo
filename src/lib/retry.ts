export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  label?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt >= opts.maxAttempts) break;
      const delay = opts.baseDelayMs * Math.pow(2, attempt - 1);
      const cap = 60_000;
      const wait = Math.min(delay, cap);
      if (opts.label) {
        console.warn(
          `[retry:${opts.label}] attempt ${attempt}/${opts.maxAttempts} failed; waiting ${wait}ms`,
          e instanceof Error ? e.message : e
        );
      }
      await sleep(wait);
    }
  }
  throw lastErr;
}
