import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: true,
  treeshake: true,
  clean: true,
  sourcemap: true,
  external: ["@solana/kit"],
  noExternal: [
    "@solana-program/address-lookup-table",
    "@solana-program/compute-budget",
    "@solana-program/system",
    "@solana-program/token",
    "@solana/transaction-messages"
  ],
})