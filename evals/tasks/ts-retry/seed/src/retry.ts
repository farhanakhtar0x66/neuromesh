export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  factor?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  throw new Error("not implemented");
}
