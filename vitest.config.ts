import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/**/*.test.ts"],
    globals: false,
    // Keep tests fast and isolated.
    pool: "forks",
    reporters: ["verbose"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
