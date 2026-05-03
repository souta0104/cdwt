import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

/**
 * Façade over stdin / stdout / stderr that the rest of the codebase depends on
 * instead of touching `process.*` directly. Lets us:
 *   - swap in a fake during tests (see TestConsole)
 *   - centralise EOF / non-TTY handling so callers never block CI pipelines
 */
export interface ConsoleIO {
  /** Write to stdout, no implicit newline. */
  out(chunk: string): void;
  /** Write to stdout followed by a newline. */
  outln(message?: string): void;
  /** Write to stderr, no implicit newline. */
  err(chunk: string): void;
  /** Write to stderr followed by a newline. */
  errln(message?: string): void;
  /**
   * Read one line from stdin, prompting on stderr.
   * Returns null on EOF or when stdin is not a TTY (so callers can fail
   * fast in non-interactive contexts instead of hanging forever).
   */
  ask(prompt: string): Promise<string | null>;
  /** Yes / no confirmation. EOF or non-TTY is treated as "no". */
  confirm(prompt: string): Promise<boolean>;
  /** True when stdin is connected to a TTY. */
  readonly isInteractive: boolean;
}

const YES = /^y(es)?$/i;

export interface DefaultConsoleStreams {
  stdin?: Readable;
  stdout?: Writable;
  stderr?: Writable;
}

export function createDefaultConsole(streams: DefaultConsoleStreams = {}): ConsoleIO {
  const stdin = streams.stdin ?? process.stdin;
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;
  const isInteractive = Boolean((stdin as { isTTY?: boolean }).isTTY);

  const console: ConsoleIO = {
    out: (chunk) => stdout.write(chunk),
    outln: (message = "") => stdout.write(`${message}\n`),
    err: (chunk) => stderr.write(chunk),
    errln: (message = "") => stderr.write(`${message}\n`),
    isInteractive,
    async ask(prompt) {
      if (!isInteractive) return null;
      const rl = createInterface({ input: stdin, output: stderr, terminal: true });
      try {
        return await rl.question(prompt);
      } catch {
        return null;
      } finally {
        rl.close();
      }
    },
    async confirm(prompt) {
      const answer = await this.ask(prompt);
      if (answer === null) return false;
      return YES.test(answer.trim());
    },
  };
  return console;
}
