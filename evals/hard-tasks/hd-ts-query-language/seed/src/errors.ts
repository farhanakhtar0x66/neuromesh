/** A query that cannot be understood. `column` is 1-based (docs/QUERY.md, "Errors"). */
export class QueryError extends Error {
  column: number;

  constructor(message: string, column: number) {
    super(message);
    this.name = "QueryError";
    this.column = column;
  }
}
