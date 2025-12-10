import { defineConfig } from "father";

const BUILD_CONFIG = { input: "src", ignores: ["src/request/preset/cdzd.ts"] };

export default defineConfig({
  esm: BUILD_CONFIG,
  cjs: BUILD_CONFIG,
});
