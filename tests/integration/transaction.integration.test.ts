import { describe, it, expect, beforeAll } from "vitest"
import { setupTest } from "./setup.js"
import { getTransferSolInstruction } from "@solana-program/system"
import { generateKey } from "../../src/keypair.js"
import { SimulationError } from "../../src/errors.js"

describe("buildTx().send() — SOL transfer", () => {
  it("transfers SOL between two accounts", async () => {

    const { client, payer } = await setupTest()
    const recipient = await generateKey()

    const transferAmount = 100_000_000n // 0.1 SOL

    // Record balances before
    const payerBefore = await client.balance(payer.address)
    const recipientBefore = await client.balance(recipient.address)

    // Build and send a SOL transfer
    const result = await client
      .buildTx({
        feePayer: payer,
        instructions: [
          getTransferSolInstruction({
            source: payer,
            destination: recipient.address,
            amount: transferAmount,
          }),
        ],
      })
      .send()

    // Verify the result shape
    expect(result.signature).toBeDefined()
    expect(typeof result.signature).toBe("string")
    expect(result.slot).toBeGreaterThan(0n)
    expect(result.retries).toBe(0)              // should land first try on localnet
    expect(result.commitment).toBe("confirmed")

    // Verify balances changed correctly
    const recipientAfter = await client.balance(recipient.address)
    expect(recipientAfter).toBe(recipientBefore + transferAmount)

    // Payer lost transfer amount + transaction fee
    // We don't know the exact fee, so just check it decreased
    const payerAfter = await client.balance(payer.address)
    expect(payerAfter).toBeLessThan(payerBefore - transferAmount)
  })

  it("returns a real explorer URL", async () => {

    const { client, payer } = await setupTest()
    const recipient = await generateKey()

    const result = await client
      .buildTx({
        feePayer: payer,
        instructions: [
          getTransferSolInstruction({
            source: payer,
            destination: recipient.address,
            amount: 10_000_000n,
          }),
        ],
      })
      .send()

    // Verify it's a real signature we could look up
    expect(result.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{87,88}$/)
  })
})

describe("buildTx().send() — simulation", () => {
  it("throws SimulationError when fee payer has no SOL", async () => {

    const client = await (async () => {
      const { connect } = await import("../../src/client.js")
      return connect("localnet")
    })()

    // A broke account — never received any SOL
    const brokeAccount = await generateKey()
    const recipient = await generateKey()

    // This should fail during simulation — before it even tries to send
    await expect(
      client
        .buildTx({
          feePayer: brokeAccount,
          instructions: [
            getTransferSolInstruction({
              source: brokeAccount,
              destination: recipient.address,
              amount: 100_000_000n,
            }),
          ],
        })
        .send(),
    ).rejects.toThrow(SimulationError)
  })

  it("SimulationError has logs", async () => {

    const { connect } = await import("../../src/client.js")
    const client = connect("localnet")
    const brokeAccount = await generateKey()
    const recipient = await generateKey()

    try {
      await client
        .buildTx({
          feePayer: brokeAccount,
          instructions: [
            getTransferSolInstruction({
              source: brokeAccount,
              destination: recipient.address,
              amount: 100_000_000n,
            }),
          ],
        })
        .send()
    } catch (e) {
      expect(e).toBeInstanceOf(SimulationError)
      if (e instanceof SimulationError) {
        // Logs should be an array of strings from the validator
        expect(Array.isArray(e.logs)).toBe(true)
        expect(e.code).toBe("SIMULATION_FAILED")
      }
    }
  })
})

describe("buildTx() modifiers", () => {
  it("withPriorityFee sends successfully", async () => {

    const { client, payer } = await setupTest()
    const recipient = await generateKey()

    // Priority fee should not break anything —
    // just costs slightly more
    const result = await client
      .buildTx({
        feePayer: payer,
        instructions: [
          getTransferSolInstruction({
            source: payer,
            destination: recipient.address,
            amount: 10_000_000n,
          }),
        ],
      })
      .withPriorityFee(1000n)
      .send()

    expect(result.signature).toBeDefined()
  })

  it("withComputeLimit sends successfully", async () => {

    const { client, payer } = await setupTest()
    const recipient = await generateKey()

    const result = await client
      .buildTx({
        feePayer: payer,
        instructions: [
          getTransferSolInstruction({
            source: payer,
            destination: recipient.address,
            amount: 10_000_000n,
          }),
        ],
      })
      .withComputeLimit(50_000)
      .send()

    expect(result.signature).toBeDefined()
  })

  it("withBlockhash uses the provided blockhash", async () => {

    const { client, payer } = await setupTest()
    const recipient = await generateKey()

    // Pre-fetch a blockhash
    const bh = await client.recentBlockhash()

    const result = await client
      .buildTx({
        feePayer: payer,
        instructions: [
          getTransferSolInstruction({
            source: payer,
            destination: recipient.address,
            amount: 10_000_000n,
          }),
        ],
      })
      .withBlockhash(bh)
      .send()

    expect(result.signature).toBeDefined()
  })
})

describe("buildTx().simulate()", () => {
  it("returns CU usage for a valid transaction", async () => {

    const { client, payer } = await setupTest()
    const recipient = await generateKey()

    const sim = await client
      .buildTx({
        feePayer: payer,
        instructions: [
          getTransferSolInstruction({
            source: payer,
            destination: recipient.address,
            amount: 10_000_000n,
          }),
        ],
      })
      .simulate()

    // SOL transfer uses ~300 compute units
    expect(sim.unitsConsumed).toBeGreaterThan(0)
    expect(sim.unitsConsumed).toBeLessThan(200_000)
    expect(Array.isArray(sim.logs)).toBe(true)
  })
})