import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    reporters: ["default"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/cli.ts",
        "src/io/test-console.ts",
        "src/types.ts",
        "src/errors.ts",
        // Thin wrappers around external binaries; covered by manual smoke
        // testing instead of unit tests because spawning them in CI would
        // either require the tool to be installed or mock it at the OS layer.
        "src/io/gh.ts",
        "src/ui/fzf.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
