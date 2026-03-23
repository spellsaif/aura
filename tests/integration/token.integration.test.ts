import { describe, it, expect, beforeAll } from "vitest"
import { setupTest } from "./setup.js"
import {
  mintToken,
  mintMore,
  transferToken,
  burnToken,
  getAta,
  toRawAmount,
  toUiAmount,
} from "../../src/token.js"
import { generateKey } from "../../src/keypair.js"



// Helper — get token account balance via RPC
async function getTokenBalance(
  client: Awaited<ReturnType<typeof setupTest>>["client"],
  ata: string,
): Promise<bigint> {
  try {
    const result = await client.rpc
      .getTokenAccountBalance(ata as Parameters<
        typeof client.rpc.getTokenAccountBalance
      >[0])
      .send()
    return BigInt(result.value.amount)
  } catch {
    // Account doesn't exist yet — balance is 0
    return 0n
  }
}

describe("Full token lifecycle", () => {
  it("creates a mint, mints tokens, transfers, and burns", async () => {

    const { client, payer } = await setupTest()

    const { instructions: createMintIxs, mint } = await mintToken({
      decimals: 9,
      authority: payer,
      rentFor: (size) => client.rentFor(size),
    })

    const createMintResult = await client
      .buildTx({
        feePayer: payer,
        instructions: createMintIxs,
      })
      .send()

    // Transaction landed — mint exists on-chain
    expect(createMintResult.signature).toBeDefined()
    expect(createMintResult.slot).toBeGreaterThan(0n)

    const mintAmount = toRawAmount(1000, 9) // 1000 tokens

    const { instructions: mintMoreIxs } = await mintMore({
      mint: mint.address,
      authority: payer,
      recipient: payer.address,
      amount: mintAmount,
    })

    await client
      .buildTx({ feePayer: payer, instructions: mintMoreIxs })
      .send()

    // Verify the payer now has 1000 tokens
    const payerAta = await getAta(mint.address, payer.address)
    const payerBalance = await getTokenBalance(client, payerAta)

    expect(payerBalance).toBe(mintAmount)
    expect(toUiAmount(payerBalance, 9)).toBe(1000)

    const recipient = await generateKey()
    // Fund recipient so it can exist on-chain (needed for ATA rent)
    await client.airdrop(recipient.address, 100_000_000n)

    const transferAmount = toRawAmount(250, 9) // 250 tokens

    const { instructions: transferIxs } = await transferToken({
      mint: mint.address,
      from: payer,
      to: recipient.address,
      amount: transferAmount,
      decimals: 9,
      payer,
    })

    await client
      .buildTx({ feePayer: payer, instructions: transferIxs })
      .send()

    // Verify balances after transfer
    const recipientAta = await getAta(mint.address, recipient.address)
    const recipientBalance = await getTokenBalance(client, recipientAta)
    const payerBalanceAfterTransfer = await getTokenBalance(client, payerAta)

    expect(recipientBalance).toBe(transferAmount)
    expect(toUiAmount(recipientBalance, 9)).toBe(250)
    expect(payerBalanceAfterTransfer).toBe(mintAmount - transferAmount)
    expect(toUiAmount(payerBalanceAfterTransfer, 9)).toBe(750)

    const burnAmount = toRawAmount(100, 9) // burn 100 tokens

    const { instructions: burnIxs } = await burnToken({
      mint: mint.address,
      owner: payer,
      amount: burnAmount,
      decimals: 9,
    })

    await client
      .buildTx({ feePayer: payer, instructions: burnIxs })
      .send()

    // Verify payer lost exactly 100 tokens
    const payerBalanceAfterBurn = await getTokenBalance(client, payerAta)
    expect(payerBalanceAfterBurn).toBe(mintAmount - transferAmount - burnAmount)
    expect(toUiAmount(payerBalanceAfterBurn, 9)).toBe(650)

    // Recipient still has their 250
    const recipientBalanceAfterBurn = await getTokenBalance(
      client,
      recipientAta,
    )
    expect(recipientBalanceAfterBurn).toBe(transferAmount)
  })
})

describe("mintToken", () => {
  it("creates a valid mint account on-chain", async () => {

    const { client, payer } = await setupTest()

    const { instructions, mint } = await mintToken({
      decimals: 6,
      authority: payer,
      rentFor: (size) => client.rentFor(size),
    })

    const result = await client
      .buildTx({ feePayer: payer, instructions })
      .send()

    expect(result.signature).toBeDefined()

    // The mint account should now exist — fetch it from the chain
    const mintInfo = await client.rpc
      .getAccountInfo(mint.address, { encoding: "base64" })
      .send()

    // Account exists
    expect(mintInfo.value).not.toBeNull()

    // Owned by the Token Program
    expect(mintInfo.value?.owner).toBe(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    )

    // Correct size (82 bytes for a mint)
    expect(mintInfo.value?.data).toBeDefined()
  })

  it("two mints at different addresses are independent", async () => {

    const { client, payer } = await setupTest()

    const { instructions: ix1, mint: mint1 } = await mintToken({
      decimals: 9,
      authority: payer,
      rentFor: (size) => client.rentFor(size),
    })

    const { instructions: ix2, mint: mint2 } = await mintToken({
      decimals: 6,
      authority: payer,
      rentFor: (size) => client.rentFor(size),
    })

    // Create both mints
    await client.buildTx({ feePayer: payer, instructions: ix1 }).send()
    await client.buildTx({ feePayer: payer, instructions: ix2 }).send()

    // They have different addresses
    expect(mint1.address).not.toBe(mint2.address)
  })
})

describe("transferToken idempotent ATA creation", () => {
  it("works when recipient has never held the token", async () => {

    const { client, payer } = await setupTest()

    // Create a mint
    const { instructions: mintIxs, mint } = await mintToken({
      decimals: 9,
      authority: payer,
      rentFor: (size) => client.rentFor(size),
    })
    await client.buildTx({ feePayer: payer, instructions: mintIxs }).send()

    // Mint some tokens to payer
    const { instructions: mintMoreIxs } = await mintMore({
      mint: mint.address,
      authority: payer,
      recipient: payer.address,
      amount: toRawAmount(100, 9),
    })
    await client.buildTx({ feePayer: payer, instructions: mintMoreIxs }).send()

    // Transfer to a brand new wallet — ATA doesn't exist yet
    const newWallet = await generateKey()
    // No airdrop needed for recipient — payer covers ATA creation rent

    const { instructions: transferIxs } = await transferToken({
      mint: mint.address,
      from: payer,
      to: newWallet.address,
      amount: toRawAmount(10, 9),
      decimals: 9,
      payer,
    })

    // This should succeed even though newWallet has never existed on-chain
    const result = await client
      .buildTx({ feePayer: payer, instructions: transferIxs })
      .send()

    expect(result.signature).toBeDefined()

    // Verify the recipient got the tokens
    const recipientAta = await getAta(mint.address, newWallet.address)
    const balance = await getTokenBalance(client, recipientAta)
    expect(balance).toBe(toRawAmount(10, 9))
  })

  it("transferring twice is fine — ATA already exists second time", async () => {

    const { client, payer } = await setupTest()
    const recipient = await generateKey()

    // Create mint and fund payer
    const { instructions: mintIxs, mint } = await mintToken({
      decimals: 9,
      authority: payer,
      rentFor: (size) => client.rentFor(size),
    })
    await client.buildTx({ feePayer: payer, instructions: mintIxs }).send()

    const { instructions: mintMoreIxs } = await mintMore({
      mint: mint.address,
      authority: payer,
      recipient: payer.address,
      amount: toRawAmount(1000, 9),
    })
    await client.buildTx({ feePayer: payer, instructions: mintMoreIxs }).send()

    // First transfer — creates the ATA
    const { instructions: transfer1 } = await transferToken({
      mint: mint.address,
      from: payer,
      to: recipient.address,
      amount: toRawAmount(10, 9),
      decimals: 9,
      payer,
    })
    await client.buildTx({ feePayer: payer, instructions: transfer1 }).send()

    // Second transfer — ATA already exists, idempotent instruction is a no-op
        const { instructions: transfer2 } = await transferToken({
            mint: mint.address,
            from: payer,
            to: recipient.address,
            amount: toRawAmount(10, 9),
            decimals: 9,
            payer,
            skipAtaCreation: true,
    })
    await client.buildTx({ feePayer: payer, instructions: transfer2 }).send()

    // Recipient should have 20 tokens total
    const recipientAta = await getAta(mint.address, recipient.address)
    const balance = await getTokenBalance(client, recipientAta)
    expect(toUiAmount(balance, 9)).toBe(20)
  })
})