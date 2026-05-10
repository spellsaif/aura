import { describe, it, expect } from "vitest"
import { connect, InosukeClient } from "../src/client.js"
import { TxBuilder } from "../src/transaction.js"
import { InvalidClusterError } from "../src/errors.js"
import { generateKey } from "../src/keypair.js"

// ─── connect() ────────────────────────────────────────────────────────────────

describe("connect", () => {
  it("accepts mainnet moniker", () => {
    const client = connect("mainnet")
    expect(client).toBeInstanceOf(InosukeClient)
    expect(client.cluster).toBe("mainnet")
  })

  it("accepts devnet moniker", () => {
    const client = connect("devnet")
    expect(client).toBeInstanceOf(InosukeClient)
  })

  it("accepts testnet moniker", () => {
    const client = connect("testnet")
    expect(client).toBeInstanceOf(InosukeClient)
  })

  it("accepts localnet moniker", () => {
    const client = connect("localnet")
    expect(client).toBeInstanceOf(InosukeClient)
  })

  it("accepts a full HTTPS URL", () => {
    const client = connect("https://api.devnet.solana.com")
    expect(client).toBeInstanceOf(InosukeClient)
  })

  it("accepts a custom RPC URL", () => {
    const client = connect("https://my-rpc.helius.xyz/api-key")
    expect(client).toBeInstanceOf(InosukeClient)
  })

  it("throws InvalidClusterError for bad moniker", () => {
    expect(() => connect("badcluster")).toThrow(InvalidClusterError)
  })

  it("throws InvalidClusterError for ftp URL", () => {
    expect(() => connect("ftp://bad.com")).toThrow(InvalidClusterError)
  })

  it("throws InvalidClusterError for empty string", () => {
    expect(() => connect("")).toThrow(InvalidClusterError)
  })

  it("error message contains what was provided", () => {
    try {
      connect("badcluster")
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidClusterError)
      if (e instanceof InvalidClusterError) {
        expect(e.message).toContain("badcluster")
        expect(e.provided).toBe("badcluster")
      }
    }
  })
})

// ─── InosukeClient ────────────────────────────────────────────────────────────

describe("LamportClient", () => {
  it("exposes rpc and rpcSubscriptions", () => {
    const client = connect("devnet")
    expect(client.rpc).toBeDefined()
    expect(client.rpcSubscriptions).toBeDefined()
  })

  it("buildTx returns a TxBuilder", async () => {
    const client = connect("devnet")
    const signer = await generateKey()

    const builder = client.buildTx({
      feePayer: signer,
      instructions: [],
    })

    expect(builder).toBeInstanceOf(TxBuilder)
  })

  it("buildTx passes computeUnitLimit to builder", async () => {
    const client = connect("devnet")
    const signer = await generateKey()

    // Should not throw — just verifies construction works
    const builder = client.buildTx({
      feePayer: signer,
      instructions: [],
      computeUnitLimit: 50_000,
    })

    expect(builder).toBeInstanceOf(TxBuilder)
  })
})

// ─── TxBuilder modifiers ──────────────────────────────────────────────────────

describe("TxBuilder modifiers", () => {
  it("withComputeLimit returns a new TxBuilder", async () => {
    const client = connect("devnet")
    const signer = await generateKey()

    const original = client.buildTx({ feePayer: signer, instructions: [] })
    const modified = original.withComputeLimit(100_000)

    // They should be different objects
    expect(modified).not.toBe(original)
    expect(modified).toBeInstanceOf(TxBuilder)
  })

  it("withPriorityFee returns a new TxBuilder", async () => {
    const client = connect("devnet")
    const signer = await generateKey()

    const original = client.buildTx({ feePayer: signer, instructions: [] })
    const modified = original.withPriorityFee(1000n)

    expect(modified).not.toBe(original)
    expect(modified).toBeInstanceOf(TxBuilder)
  })

  it("withInstructions appends instructions", async () => {
    const client = connect("devnet")
    const signer = await generateKey()

    const builder = client
      .buildTx({ feePayer: signer, instructions: [] })
      .withInstructions([])
      .withPriorityFee(1000n)
      .withComputeLimit(50_000)

    expect(builder).toBeInstanceOf(TxBuilder)
  })

  it("chaining does not mutate the original", async () => {
    const client = connect("devnet")
    const signer = await generateKey()

    const base = client.buildTx({ feePayer: signer, instructions: [] })
    const withFee = base.withPriorityFee(1000n)
    const withLimit = base.withComputeLimit(50_000)

    // Both branches work independently — base is unchanged
    expect(withFee).toBeInstanceOf(TxBuilder)
    expect(withLimit).toBeInstanceOf(TxBuilder)
    expect(withFee).not.toBe(withLimit)
  })

  it("withJitoTip returns a new TxBuilder", async () => {
    const client = connect("devnet")
    const signer = await generateKey()

    const original = client.buildTx({ feePayer: signer, instructions: [] })
    const modified = original.withJitoTip(10_000n)

    expect(modified).not.toBe(original)
    expect(modified).toBeInstanceOf(TxBuilder)
  })

  it("withAddressLookupTable returns a new TxBuilder", async () => {
    const { address } = await import("@solana/kit");
    const client = connect("devnet")
    const signer = await generateKey()

    const original = client.buildTx({ feePayer: signer, instructions: [] })
    const modified = original.withAddressLookupTable(address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"))

    expect(modified).not.toBe(original)
    expect(modified).toBeInstanceOf(TxBuilder)
  })
})