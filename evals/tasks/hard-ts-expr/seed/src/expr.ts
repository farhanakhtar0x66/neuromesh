export class ExprError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = "ExprError";
    this.position = position;
  }
}

export function evaluate(source: string, vars: Record<string, number> = {}): number {
  throw new ExprError("not implemented", 0);
}
