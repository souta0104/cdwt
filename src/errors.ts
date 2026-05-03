/** Thrown when the user-facing message should be printed and the process exited with `code`. */
export class CdwtError extends Error {
  constructor(
    message: string,
    public readonly code: number = 1,
  ) {
    super(message);
    this.name = "CdwtError";
  }
}
