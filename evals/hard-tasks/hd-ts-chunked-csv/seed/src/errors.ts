/** Anything wrong with the input or the options. The message is part of the interface (docs/FORMAT.md). */
export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}
