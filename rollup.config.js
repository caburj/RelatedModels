import { defineConfig } from "rollup";
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default defineConfig({
  input: "index.js",
  output: {
    file: "build/rm.js",
    format: "iife",
    name: "rm",
  },
  plugins: [nodeResolve()],
});
