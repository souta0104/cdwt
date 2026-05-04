import type { ConsoleIO } from "./console.js";

/**
 * Test double for ConsoleIO. Records every write into separate buffers and
 * answers `ask` from a queue (set via `queueResponses`). When the queue is
 * exhausted, `ask` returns null (mirroring EOF), so tests must opt-in to
 * each response.
 */
export class TestConsole implements ConsoleIO {
  isInteractive = true;
  private readonly outBuf: string[] = [];
  private readonly errBuf: string[] = [];
  private readonly debugBuf: string[] = [];
  private readonly responses: (string | null)[] = [];
  private readonly prompts: string[] = [];
  /** When true, debug() records lines into debugBuf. Default false (no-op). */
  verbose = false;

  out(chunk: string): void {
    this.outBuf.push(chunk);
  }
  outln(message = ""): void {
    this.outBuf.push(`${message}\n`);
  }
  err(chunk: string): void {
    this.errBuf.push(chunk);
  }
  errln(message = ""): void {
    this.errBuf.push(`${message}\n`);
  }
  debug(message: string): void {
    if (!this.verbose) return;
    this.debugBuf.push(message);
  }

  ask(prompt: string): Promise<string | null> {
    this.prompts.push(prompt);
    const answer = this.responses.length === 0 ? null : (this.responses.shift() ?? null);
    return Promise.resolve(answer);
  }

  async confirm(prompt: string): Promise<boolean> {
    const answer = await this.ask(prompt);
    if (answer === null) return false;
    return /^y(es)?$/i.test(answer.trim());
  }

  queueResponses(...values: (string | null)[]): void {
    this.responses.push(...values);
  }

  get stdout(): string {
    return this.outBuf.join("");
  }
  get stderr(): string {
    return this.errBuf.join("");
  }
  get debugLines(): readonly string[] {
    return this.debugBuf;
  }
  get askedPrompts(): readonly string[] {
    return this.prompts;
  }
}
