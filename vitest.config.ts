import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only this repo's own suites. Without an explicit include, vitest crawls
    // into git worktrees under .claude/ and build output, where files can't
    // resolve their tsconfig and "fail" despite nothing being wrong.
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", ".output/**", ".wxt/**", ".claude/**"],
  },
});
