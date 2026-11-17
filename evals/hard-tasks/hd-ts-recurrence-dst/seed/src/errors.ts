/** A rule that cannot be scheduled. The message is part of the interface. */
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}
