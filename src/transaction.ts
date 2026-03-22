import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  compileTransaction,
  getBase64EncodedWireTransaction,
} from "@solana/kit"
import type {
  IInstruction,
  TransactionSigner,
  TransactionMessageWithBlockhashLifetime,
} from "@solana/kit"
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget"
import { SimulationError, BlockhashExpiredError } from "./errors.js"
import { parseSimulationLogs, sleep } from "./utils.js"
import type { LatestBlockhash, SendOptions, SendResult } from "./types.js"

// ─── Constants ────────────────────────────────────────────────────────────────

// Add 10% on top of simulated CU usage as a safety buffer.
// Why 10%? Programs can use slightly more CUs on mainnet than
// on simulation due to different account states. 10% covers this
// without wasting too much budget.
const COMPUTE_UNIT_BUFFER = 1.1

// Fallback limit when simulation is skipped.
// 200_000 is a reasonable default for simple transactions.
// Complex transactions (multiple instructions, large programs) need more.
const DEFAULT_COMPUTE_UNIT_LIMIT = 200_000

// ─── State ────────────────────────────────────────────────────────────────────

// This is the internal state of a TxBuilder.
// We keep it separate from the class so it's clear what data the builder holds.
interface TxBuilderState {
  feePayer: TransactionSigner
  instructions: IInstruction[]
  computeUnitLimit?: number    // undefined = auto-simulate
  computeUnitPrice?: bigint   // undefined = no priority fee
  latestBlockhash?: LatestBlockhash  // undefined = auto-fetch
  // These are injected by LamportClient — the builder needs the
  // RPC connection to simulate and send
  rpc: RpcConnection
  rpcSubscriptions: RpcSubscriptionsConnection
}

// Kit's RPC types are complex generics. We use these aliases
// to avoid repeating them everywhere.
type RpcConnection = ReturnType<typeof import("@solana/kit").createSolanaRpc>
type RpcSubscriptionsConnection = ReturnType<typeof import("@solana/kit").createSolanaRpcSubscriptions>

// TxBuilder

/**
 * A fluent transaction builder.
 * Created by client.buildTx() — not constructed directly.
 *
 * Every modifier method returns a NEW TxBuilder with the updated state.
 * The original is never mutated.
 *
 * Why immutable? So you can branch:
 *   const base = client.buildTx({ feePayer, instructions })
 *   const withFee = base.withPriorityFee(1000n)
 *   const withLimit = base.withComputeLimit(50_000)
 *   // base is unchanged — both branches work independently
 */
export class TxBuilder {
  // Private — callers should not access state directly
  private readonly state: TxBuilderState

  constructor(state: TxBuilderState) {
    this.state = state
  }

  // Modifiers

  /**
   * Override the compute unit limit.
   * By default lamport simulates and sets this automatically.
   * Use this when you know exactly how many CUs your transaction needs.
   *
   * @example
   * client.buildTx({...}).withComputeLimit(100_000).send()
   */
  withComputeLimit(units: number): TxBuilder {
    // Return a new TxBuilder — never mutate the existing one
    return new TxBuilder({ ...this.state, computeUnitLimit: units })
  }

  /**
   * Set a priority fee in microLamports per compute unit.
   *
   * What is a priority fee? Validators process transactions in order
   * of fee per CU. During congestion, paying more = landing faster.
   * 0 = no priority (fine during normal times)
   * 1000 = low priority
   * 10_000 = medium priority
   * 100_000+ = high priority (expensive but reliable during congestion)
   *
   * @example
   * client.buildTx({...}).withPriorityFee(1000n).send()
   */
  withPriorityFee(microLamports: bigint): TxBuilder {
    return new TxBuilder({ ...this.state, computeUnitPrice: microLamports })
  }

  /**
   * Append additional instructions to the transaction.
   *
   * @example
   * client.buildTx({ feePayer, instructions: [mainIx] })
   *   .withInstructions([memoIx, referenceIx])
   *   .send()
   */
  withInstructions(instructions: IInstruction[]): TxBuilder {
    return new TxBuilder({
      ...this.state,
      instructions: [...this.state.instructions, ...instructions],
    })
  }

  /**
   * Provide a pre-fetched blockhash.
   * Skips the auto-fetch inside .send().
   *
   * Useful when you're sending multiple transactions and want them
   * all to use the same blockhash — saves RPC calls.
   *
   * @example
   * const bh = await client.recentBlockhash()
   * await Promise.all([
   *   client.buildTx({...}).withBlockhash(bh).send(),
   *   client.buildTx({...}).withBlockhash(bh).send(),
   * ])
   */
  withBlockhash(latestBlockhash: LatestBlockhash): TxBuilder {
    return new TxBuilder({ ...this.state, latestBlockhash })
  }

  // Simulate

  /**
   * Simulate the transaction and return compute unit usage.
   *
   * This runs the transaction against the current chain state
   * WITHOUT actually submitting it. No fees paid. No state changes.
   *
   * Called automatically by .send() unless you call .withComputeLimit().
   *
   * Why simulate before sending?
   * 1. Catch errors before paying fees
   * 2. Measure actual CU usage to set an accurate limit
   * 3. Avoid "exceeded compute budget" failures on-chain
   */
  async simulate(): Promise<{ unitsConsumed: number; logs: string[] }> {
    const { rpc, feePayer, instructions } = this.state

    // We need a blockhash for the simulation message
    // replaceRecentBlockhash: true below means the RPC will substitute
    // a fresh one anyway — we just need something valid to build with
    const { value: blockhash } = await rpc
      .getLatestBlockhash({ commitment: "confirmed" })
      .send()

    // Build the transaction message for simulation
    // We use DEFAULT_COMPUTE_UNIT_LIMIT here — if the real limit
    // were too low, simulation would fail and we'd get a misleading error
    const message = await this._buildMessage(
      blockhash,
      DEFAULT_COMPUTE_UNIT_LIMIT,
    )

    // Compile and encode — same process as real sending
    const compiled = compileTransaction(message)
    const encoded = getBase64EncodedWireTransaction(compiled)

    // simulateTransaction runs the tx against the validator's current state
    // replaceRecentBlockhash: true — use the validator's current blockhash
    // so we don't need an exact recent one for simulation
    const result = await rpc
      .simulateTransaction(
        encoded as Parameters<typeof rpc.simulateTransaction>[0],
        {
          encoding: "base64",
          replaceRecentBlockhash: true,
          commitment: "confirmed",
        },
      )
      .send()

    const { value } = result
    const logs = (value.logs ?? []) as string[]

    // If simulation shows an error, the transaction WILL fail on-chain
    // Throw now before the user pays fees on a doomed transaction
    if (value.err !== null) {
      const reason =
        parseSimulationLogs(logs) ??
        `Transaction simulation failed: ${JSON.stringify(value.err)}`
      throw new SimulationError(reason, logs)
    }

    return {
      unitsConsumed: Number(value.unitsConsumed ?? DEFAULT_COMPUTE_UNIT_LIMIT),
      logs,
    }
  }

  // Send

  /**
   * Sign, send, and confirm the transaction.
   *
   * Automatically:
   * - Fetches a recent blockhash (unless withBlockhash() was called)
   * - Simulates to measure CUs (unless withComputeLimit() was called)
   * - Retries on blockhash expiry with exponential backoff
   * - Waits for confirmation at the specified commitment level
   *
   * @example
   * const result = await client.buildTx({...}).send()
   * console.log(result.signature)
   * console.log(result.retries) // 0 if it landed first try
   */
  async send(options: SendOptions = {}): Promise<SendResult> {
    const {
      maxRetries = 3,
      commitment = "confirmed",
      skipPreflight = false,
    } = options

    let retries = 0

    // Retry loop — runs until success or maxRetries exhausted
    while (retries <= maxRetries) {
      // Always fetch a fresh blockhash on each attempt
      // A failed attempt means the old blockhash may be stale
      const { rpc } = this.state
      const { value: latestBlockhash } = await rpc
        .getLatestBlockhash({ commitment: "confirmed" })
        .send()

      // Auto compute budget
      // If the caller didn't set a manual limit, simulate to measure CUs
      let computeUnitLimit = this.state.computeUnitLimit

      if (computeUnitLimit === undefined && !skipPreflight) {
        // simulate() throws SimulationError if the tx will fail
        // We let that propagate — no point retrying a tx that will fail
        const sim = await this.simulate()

        // Add 10% buffer on top of measured usage
        // Math.ceil rounds up to avoid setting a fractional CU limit
        computeUnitLimit = Math.ceil(sim.unitsConsumed * COMPUTE_UNIT_BUFFER)
      }

      // ── Build, sign, compile ────────────────────────────────────────────────
      const message = await this._buildMessage(latestBlockhash, computeUnitLimit)

      // signTransactionMessageWithSigners looks at all accounts in the
      // message that are marked as signers and calls their sign functions
      // This is why you pass TransactionSigner not just an Address for feePayer
      const signed = await signTransactionMessageWithSigners(message)

      // compileTransaction serializes the message into binary wire format
      // getBase64EncodedWireTransaction base64-encodes it for the RPC
      const encoded = getBase64EncodedWireTransaction(
        compileTransaction(signed),
      )

    
      try {
        const signature = await rpc
          .sendTransaction(
            encoded as Parameters<typeof rpc.sendTransaction>[0],
            {
              encoding: "base64",
              skipPreflight,
              preflightCommitment: commitment,
              // maxRetries: 0 — we handle retries ourselves
              // If we let the RPC retry, it reuses the same blockhash
              // which will eventually expire. We retry with a fresh blockhash.
              maxRetries: 0n,
            },
          )
          .send()

        // Wait for the validator network to confirm the transaction
        // confirmTransaction subscribes via WebSocket and waits for
        // the specified commitment level
        const confirmResult = await rpc
          .confirmTransaction(
            {
              signature,
              blockhash: latestBlockhash.blockhash,
              lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            } as Parameters<typeof rpc.confirmTransaction>[0],
            { commitment },
          )
          .send()

        const slot = confirmResult.context.slot

        // Success — return the typed result
        return {
          signature: signature as SendResult["signature"],
          slot,
          retries,
          commitment,
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e)

        // ── Blockhash expiry ──────────────────────────────────────────────────
        // This is the most common transient failure.
        // The blockhash is only valid for ~60 seconds.
        // We catch it, increment retries, and loop with a fresh blockhash.
        if (
          message.includes("BlockhashNotFound") ||
          message.includes("block height exceeded") ||
          message.includes("Blockhash not found")
        ) {
          if (retries < maxRetries) {
            retries++
            // Exponential backoff — wait longer between each retry
            // Retry 1: 500ms, Retry 2: 1000ms, Retry 3: 1500ms
            await sleep(500 * retries)
            continue // back to top of while loop
          }

          // All retries exhausted — throw our typed error
          throw new BlockhashExpiredError({ cause: e })
        }

        // Any other error — surface it directly
        // Don't wrap unknown errors — we don't know what they are
        throw e
      }
    }

    // Should never reach here — the loop either returns or throws
    // But TypeScript needs this for exhaustiveness
    throw new BlockhashExpiredError()
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  /**
   * Build the transaction message using kit's pipe() pattern.
   *
   * pipe() takes a value and passes it through a series of functions.
   * Each function receives the output of the previous one.
   * Nothing is mutated — each step returns a new message object.
   *
   * Why pipe()? It makes the transaction construction readable
   * as a sequence of steps, and it's type-safe — TypeScript tracks
   * what properties the message has after each step.
   *
   * @internal
   */
  private async _buildMessage(
    blockhash: { blockhash: string; lastValidBlockHeight: bigint },
    computeUnitLimit?: number,
  ) {
    const { feePayer, instructions, computeUnitPrice } = this.state

    return pipe(
      // Step 1: create empty transaction message
      // "legacy" version works for most transactions
      // version 0 is needed for Address Lookup Tables (advanced)
      createTransactionMessage({ version: "legacy" }),

      // Step 2: set who pays the transaction fee
      // setTransactionMessageFeePayerSigner uses the signer's .address
      // and marks it as a required signer in the message
      (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),

      // Step 3: set the blockhash lifetime
      // This embeds the blockhash into the message AND records
      // lastValidBlockHeight so kit can detect expiry
      (tx) =>
        setTransactionMessageLifetimeUsingBlockhash(
          blockhash as TransactionMessageWithBlockhashLifetime["lifetimeConstraint"],
          tx,
        ),

      // Step 4: prepend compute unit limit instruction (if set)
      // This MUST come before your actual instructions
      // The compute budget program reads this to set the CU cap
      (tx) => {
        if (computeUnitLimit !== undefined) {
          return appendTransactionMessageInstruction(
            getSetComputeUnitLimitInstruction({ units: computeUnitLimit }),
            tx,
          )
        }
        return tx
      },

      // Step 5: prepend priority fee instruction (if set)
      // Also goes before your actual instructions
      (tx) => {
        if (computeUnitPrice !== undefined) {
          return appendTransactionMessageInstruction(
            getSetComputeUnitPriceInstruction({
              microLamports: computeUnitPrice,
            }),
            tx,
          )
        }
        return tx
      },

      // Step 6: append your actual instructions
      // These come after the compute budget instructions
      (tx) => appendTransactionMessageInstructions(instructions, tx),
    )
  }
}