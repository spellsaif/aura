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
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  assertIsTransactionWithBlockhashLifetime,
} from "@solana/kit"
import type {
  TransactionSigner,
  TransactionMessageWithBlockhashLifetime,
  Instruction,
} from "@solana/kit"
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget"
import { SimulationError, BlockhashExpiredError } from "./errors.js"
import { parseSimulationLogs, sleep } from "./utils.js"
import type { LatestBlockhash, SendOptions, SendResult } from "./types.js"

//  Constants 

// Add 10% on top of simulated CU usage as a safety buffer.
// Why 10%? Programs can use slightly more CUs on mainnet than
// on simulation due to different account states. 10% covers this
// without wasting too much budget.
const COMPUTE_UNIT_BUFFER = 1.1

// Fallback limit when simulation is skipped.
// 200_000 is a reasonable default for simple transactions.
// Complex transactions (multiple instructions, large programs) need more.
const DEFAULT_COMPUTE_UNIT_LIMIT = 200_000

// State 

// This is the internal state of a TxBuilder.
// We keep it separate from the class so it's clear what data the builder holds.
interface TxBuilderState {
  feePayer: TransactionSigner
  instructions: Instruction[]                    
  computeUnitLimit: number | undefined           
  computeUnitPrice: bigint | undefined           
  latestBlockhash: LatestBlockhash | undefined   
  rpc: RpcConnection
  rpcSubscriptions: RpcSubscriptionsConnection
}

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
   withInstructions(instructions: Instruction[]): TxBuilder {
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
      maxRetries    = 3,
      commitment    = "confirmed",
      skipPreflight = false,
    } = options

    const { rpc, rpcSubscriptions } = this.state

    // Create the sendAndConfirm function once — reused across retries
    // This is the new API replacing rpc.confirmTransaction()
    const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
  rpc: rpc as Parameters<typeof sendAndConfirmTransactionFactory>[0]["rpc"],
  rpcSubscriptions: rpcSubscriptions as Parameters<typeof sendAndConfirmTransactionFactory>[0]["rpcSubscriptions"],
})

    let retries = 0

    while (retries <= maxRetries) {
      const { value: latestBlockhash } = await rpc
        .getLatestBlockhash({ commitment: "confirmed" })
        .send()

      let computeUnitLimit = this.state.computeUnitLimit

      if (computeUnitLimit === undefined && !skipPreflight) {
        const sim = await this.simulate()
        computeUnitLimit = Math.ceil(sim.unitsConsumed * COMPUTE_UNIT_BUFFER)
      }

      const message = await this._buildMessage(latestBlockhash, computeUnitLimit)
      const signed  = await signTransactionMessageWithSigners(message)

      assertIsTransactionWithBlockhashLifetime(signed)

      const signature = getSignatureFromTransaction(signed)

      try {
        // sendAndConfirmTransaction handles encoding, sending, and confirming
        // It uses WebSocket subscriptions internally for efficient confirmation
        await sendAndConfirmTransaction(signed, { commitment })

        // Get the slot from the RPC after confirmation
        const sigStatus = await rpc
          .getSignatureStatuses([signature])
          .send()

        const slot = sigStatus.value[0]?.slot ?? 0n

        return {
          signature,
          slot,
          retries,
          commitment,
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)

        if (
          msg.includes("BlockhashNotFound") ||
          msg.includes("block height exceeded") ||
          msg.includes("Blockhash not found")
        ) {
          if (retries < maxRetries) {
            retries++
            await sleep(500 * retries)
            continue
          }
          throw new BlockhashExpiredError({ cause: e })
        }

        throw e
      }
    }

    throw new BlockhashExpiredError()
  }

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
    computeUnitLimit: number | undefined,
  ) {
    const { feePayer, instructions, computeUnitPrice } = this.state

    return pipe(
      createTransactionMessage({ version: "legacy" }),
      (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
      (tx) =>
        setTransactionMessageLifetimeUsingBlockhash(
          blockhash as TransactionMessageWithBlockhashLifetime["lifetimeConstraint"],
          tx,
        ),
      (tx) => {
        if (computeUnitLimit !== undefined) {
          return appendTransactionMessageInstruction(
            getSetComputeUnitLimitInstruction({ units: computeUnitLimit }),
            tx,
          )
        }
        return tx
      },
      (tx) => {
        if (computeUnitPrice !== undefined) {
          return appendTransactionMessageInstruction(
            getSetComputeUnitPriceInstruction({ microLamports: computeUnitPrice }),
            tx,
          )
        }
        return tx
      },
      (tx) => appendTransactionMessageInstructions(instructions, tx),
    )
  }
}