import { describe, it, expect } from "vitest"
import {
  mintToken,
  mintMore,
  transferToken,
  burnToken,
  getAta,
  toRawAmount,
  toUiAmount,
  MINT_SIZE,
  TOKEN_ACCOUNT_SIZE,
} from "../src/token.js"
import { generateKey } from "../src/keypair.js"
import { Address } from "@solana/kit"

// ─── Constants ────────────────────────────────────────────────────────────────

describe("constants", () => {
  it("MINT_SIZE is 82", () => {
    // This is defined by the Token Program spec
    // If this changes, everything breaks — good to have a test
    expect(MINT_SIZE).toBe(82)
  })

  it("TOKEN_ACCOUNT_SIZE is 165", () => {
    expect(TOKEN_ACCOUNT_SIZE).toBe(165)
  })
})

// ─── toRawAmount ──────────────────────────────────────────────────────────────

describe("toRawAmount", () => {
  it("converts 1 token with 9 decimals", () => {
    expect(toRawAmount(1, 9)).toBe(1_000_000_000n)
  })

  it("converts fractional amount", () => {
    expect(toRawAmount(1.5, 9)).toBe(1_500_000_000n)
  })

  it("handles 0 decimals (NFTs)", () => {
    // NFTs have 0 decimals — 1 means 1, no fractions
    expect(toRawAmount(1, 0)).toBe(1n)
    expect(toRawAmount(100, 0)).toBe(100n)
  })

  it("handles 6 decimals (USDC-style)", () => {
    expect(toRawAmount(1, 6)).toBe(1_000_000n)
  })

  it("handles floating point edge case", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS
    expect(toRawAmount(0.1 + 0.2, 9)).toBe(300_000_000n)
  })

  it("handles zero", () => {
    expect(toRawAmount(0, 9)).toBe(0n)
  })
})

// ─── toUiAmount ───────────────────────────────────────────────────────────────

describe("toUiAmount", () => {
  it("converts 1 token with 9 decimals", () => {
    expect(toUiAmount(1_000_000_000n, 9)).toBe(1)
  })

  it("converts fractional amount", () => {
    expect(toUiAmount(1_500_000_000n, 9)).toBe(1.5)
  })

  it("handles 0 decimals", () => {
    expect(toUiAmount(100n, 0)).toBe(100)
  })

  it("round trips with toRawAmount", () => {
    const original = 1.5
    expect(toUiAmount(toRawAmount(original, 9), 9)).toBeCloseTo(original)
  })
})

// ─── getAta ───────────────────────────────────────────────────────────────────

describe("getAta", () => {
  it("returns a string address", async () => {
    const mint = "So11111111111111111111111111111111111111112" as const
    const owner = "11111111111111111111111111111112" as const

    const ata = await getAta(mint, owner)

    expect(typeof ata).toBe("string")
    expect(ata.length).toBeGreaterThan(30)
  })

  it("is deterministic — same inputs same output", async () => {
    const mint = "So11111111111111111111111111111111111111112" as const
    const owner = "11111111111111111111111111111112" as const

    const ata1 = await getAta(mint, owner)
    const ata2 = await getAta(mint, owner)

    expect(ata1).toBe(ata2)
  })

  it("different owners produce different ATAs", async () => {
    const mint = "So11111111111111111111111111111111111111112" as const
    const owner1 = "11111111111111111111111111111112" as const
    const owner2 = "Vote111111111111111111111111111111111111111" as const

    const ata1 = await getAta(mint, owner1)
    const ata2 = await getAta(mint, owner2)

    expect(ata1).not.toBe(ata2)
  })

  it("different mints produce different ATAs", async () => {
    const mint1 = "So11111111111111111111111111111111111111112" as Address
    const mint2 = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address
    const owner = "11111111111111111111111111111112" as Address

    const ata1 = await getAta(mint1, owner)
    const ata2 = await getAta(mint2, owner)

    expect(ata1).not.toBe(ata2)
  })
})

// ─── mintToken ────────────────────────────────────────────────────────────────

describe("mintToken", () => {
  it("returns instructions and a mint signer", async () => {
    const authority = await generateKey()

    const { instructions, mint } = await mintToken({
      decimals: 9,
      authority,
      rentFor: async () => 1_461_600n, // mock rent
    })

    // Should return exactly 2 instructions
    // 1: createAccount, 2: initializeMint
    expect(instructions).toHaveLength(2)

    // Mint should be a valid signer with an address
    expect(mint.address).toBeDefined()
    expect(typeof mint.address).toBe("string")
  })

  it("uses provided mint if given", async () => {
    const authority = await generateKey()
    const customMint = await generateKey()

    const { mint } = await mintToken({
      decimals: 9,
      authority,
      mint: customMint,
      rentFor: async () => 1_461_600n,
    })

    // Should use our custom mint, not generate a new one
    expect(mint.address).toBe(customMint.address)
  })

  it("generates a new mint if not provided", async () => {
    const authority = await generateKey()

    const { mint: mint1 } = await mintToken({
      decimals: 9,
      authority,
      rentFor: async () => 1_461_600n,
    })

    const { mint: mint2 } = await mintToken({
      decimals: 9,
      authority,
      rentFor: async () => 1_461_600n,
    })

    // Each call should generate a unique mint
    expect(mint1.address).not.toBe(mint2.address)
  })

  it("works with 0 decimals (NFT-style)", async () => {
    const authority = await generateKey()

    const { instructions } = await mintToken({
      decimals: 0,
      authority,
      rentFor: async () => 1_461_600n,
    })

    expect(instructions).toHaveLength(2)
  })
})

// ─── mintMore ────────────────────────────────────────────────────────────────

describe("mintMore", () => {
  it("returns 2 instructions", async () => {
    const authority = await generateKey()
    const recipient = await generateKey()
    const mint = "So11111111111111111111111111111111111111112" as Address

    const { instructions } = await mintMore({
      mint,
      authority,
      recipient: recipient.address,
      amount: 1_000_000_000n,
    })

    // 1: createAssociatedTokenAccountIdempotent
    // 2: mintTo
    expect(instructions).toHaveLength(2)
  })
})

// ─── transferToken ────────────────────────────────────────────────────────────

describe("transferToken", () => {
  it("returns 2 instructions", async () => {
    const from = await generateKey()
    const to = await generateKey()
    const mint = "So11111111111111111111111111111111111111112" as Address

    const { instructions } = await transferToken({
      mint,
      from,
      to: to.address,
      amount: 500_000_000n,
      decimals: 9,
      payer: from,
    })

    // 1: createAssociatedTokenAccountIdempotent (for recipient)
    // 2: transferChecked
    expect(instructions).toHaveLength(2)
  })

  it("payer can be different from sender", async () => {
    const from = await generateKey()
    const to = await generateKey()
    const payer = await generateKey()
    const mint = "So11111111111111111111111111111111111111112" as Address

    const { instructions } = await transferToken({
      mint,
      from,
      to: to.address,
      amount: 500_000_000n,
      decimals: 9,
      payer, // third party pays for ATA creation
    })

    expect(instructions).toHaveLength(2)
  })
})

// ─── burnToken ────────────────────────────────────────────────────────────────

describe("burnToken", () => {
  it("returns 1 instruction", async () => {
    const owner = await generateKey()
    const mint = "So11111111111111111111111111111111111111112" as Address

    const { instructions } = await burnToken({
      mint,
      owner,
      amount: 100_000_000n,
      decimals: 9,
    })

    // Burn is just 1 instruction — no ATA creation needed
    // You can only burn from an account you already have
    expect(instructions).toHaveLength(1)
  })
})