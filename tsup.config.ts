import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", fs: "src/fs.ts", node: "src/node.ts" },
  format: ["esm", "cjs"],
  // Las declaraciones las emite `tsc` con `tsconfig.build.json`: el generador
  // de tipos de tsup usa la API JavaScript del compilador, que TypeScript 7 ya
  // no publica.
  sourcemap: true,
  clean: true,
  target: "es2022",
});
