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
  Address,
} from "@solana/kit"
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget"
import { getTransferSolInstruction } from "@solana-program/system"
import { SimulationError, BlockhashExpiredError } from "./errors.js"
import { parseSimulationLogs, sleep } from "./utils.js"
import type { LatestBlockhash, SendOptions, SendResult, ClusterInput } from "./types.js"

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
  lookupTables: Address[]
  jitoTip: bigint | undefined
  jitoEngine: string | undefined
  dynamicPriorityFeeLevel?: "low" | "medium" | "high" | "veryHigh" | undefined
  cluster: ClusterInput
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
   * Set a dynamic, congestion-aware priority fee based on the localized fee market.
   *
   * What is a dynamic priority fee? It queries the RPC specifically for fees
   * on the write/read accounts involved in this transaction, then applies
   * a percentile fee based on the requested level:
   * - "low": 25th percentile
   * - "medium": 50th percentile (median)
   * - "high": 75th percentile
   * - "veryHigh": 95th percentile
   *
   * @example
   * client.buildTx({...}).withDynamicPriorityFee("high").send()
   */
  withDynamicPriorityFee(level: "low" | "medium" | "high" | "veryHigh"): TxBuilder {
    return new TxBuilder({ ...this.state, dynamicPriorityFeeLevel: level })
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

  /**
   * Add an Address Lookup Table (ALT) to compress the transaction payload.
   * This is required for complex transactions that exceed the 1232-byte limit.
   */
  withAddressLookupTable(address: Address): TxBuilder {
    return new TxBuilder({
      ...this.state,
      lookupTables: [...this.state.lookupTables, address],
    })
  }

  /**
   * Add a Jito Tip to the transaction to bypass network congestion and protect against MEV.
   * If this is set, the transaction is sent directly to the Jito Block Engine instead of public RPC.
   * 
   * @example
   * client.buildTx({...}).withJitoTip(10_000n).send()
   */
  withJitoTip(microLamports: bigint): TxBuilder {
    return new TxBuilder({ ...this.state, jitoTip: microLamports })
  }

  /**
   * Override the Jito Block Engine URL (e.g. for regional block engines).
   * Default is determined by client.cluster (mainnet vs devnet).
   */
  withJitoEngine(url: string): TxBuilder {
    return new TxBuilder({ ...this.state, jitoEngine: url })
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

      let resolvedPriorityFee = this.state.computeUnitPrice

      if (this.state.dynamicPriorityFeeLevel !== undefined && resolvedPriorityFee === undefined) {
        try {
          const accounts = this.state.instructions.flatMap(ix => ix.accounts?.map(acc => acc.address) || [])
          const uniqueAccounts = [...new Set(accounts)]
          const fees = await rpc.getRecentPrioritizationFees(uniqueAccounts).send()
          
          if (fees && fees.length > 0) {
            const prices = fees
              .map(f => BigInt(f.prioritizationFee))
              .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
            const percentile = 
              this.state.dynamicPriorityFeeLevel === "low" ? 0.25 :
              this.state.dynamicPriorityFeeLevel === "medium" ? 0.50 :
              this.state.dynamicPriorityFeeLevel === "high" ? 0.75 :
              0.95
            const index = Math.min(prices.length - 1, Math.floor(prices.length * percentile))
            resolvedPriorityFee = prices[index]!
          }
        } catch (e) {
          // Fallback to floor if query fails
        }
        
        // Apply floor
        if (resolvedPriorityFee === undefined || resolvedPriorityFee < 1000n) {
          resolvedPriorityFee = 1000n
        }
      }

      const message = await this._buildMessage(latestBlockhash, computeUnitLimit, resolvedPriorityFee)
      const signed  = await signTransactionMessageWithSigners(message)

      assertIsTransactionWithBlockhashLifetime(signed)

      const signature = getSignatureFromTransaction(signed)

      try {
        if (this.state.jitoTip !== undefined) {
          let jitoUrl = this.state.jitoEngine;
          if (!jitoUrl) {
            const cluster = this.state.cluster;
            if (cluster === "mainnet") {
              jitoUrl = "https://mainnet.block-engine.jito.wtf/api/v1/transactions";
            } else if (cluster === "devnet") {
              jitoUrl = "https://dallas.mainnet.block-engine.jito.wtf/api/v1/transactions";
            } else {
              throw new Error(`Jito is not supported on cluster: ${cluster}. Jito is only supported on mainnet and devnet.`);
            }
          }

          const encodedTx = getBase64EncodedWireTransaction(signed);
          const response = await fetch(jitoUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "sendTransaction",
              params: [encodedTx, { encoding: "base64" }]
            })
          });
          
          if (!response.ok) {
            throw new Error(`Jito Bundle Error: ${await response.text()}`);
          }
          
          // Poll for confirmation
          let confirmed = false;
          const targetStatuses: string[] = [commitment];
          if (commitment === "processed") {
            targetStatuses.push("confirmed", "finalized");
          } else if (commitment === "confirmed") {
            targetStatuses.push("finalized");
          }

          for (let i = 0; i < 30; i++) {
             await sleep(1000);
             const sigStatus = await rpc.getSignatureStatuses([signature]).send();
             const status = sigStatus.value[0];
             if (status) {
               if (status.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
               if (status.confirmationStatus && targetStatuses.includes(status.confirmationStatus)) {
                 confirmed = true;
                 break;
               }
             }
          }
          if (!confirmed) throw new Error("Jito transaction timeout");
        } else {
          // sendAndConfirmTransaction handles encoding, sending, and confirming
          // It uses WebSocket subscriptions internally for efficient confirmation
          await sendAndConfirmTransaction(signed, { commitment })
        }

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
    dynamicFeeOverride?: bigint,
  ) {
    const { feePayer, instructions, computeUnitPrice, lookupTables, rpc } = this.state
    const finalPrice = dynamicFeeOverride !== undefined ? dynamicFeeOverride : computeUnitPrice

    let message = pipe(
      createTransactionMessage({ version: 0 }),
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
        if (finalPrice !== undefined) {
          return appendTransactionMessageInstruction(
            getSetComputeUnitPriceInstruction({ microLamports: finalPrice }),
            tx,
          )
        }
        return tx
      },
      (tx) => appendTransactionMessageInstructions(instructions, tx),
      (tx) => {
        if (this.state.jitoTip !== undefined) {
          let tipAccounts: Address[];
          const cluster = this.state.cluster;
          
          if (cluster === "devnet") {
            tipAccounts = [
              "2MCne6aF8UrwUeaZ1XSxt2ece9As5p1QZ8795G1Yt4rX",
              "3357rnCR5U4k18Ek2s5GmeeaQifXBnu4CjPcjzNq6pdx",
              "34M253jB7exA55K2g5jFfFphG16V39fDCL6Hwth2G1nZ",
              "35kZdfP5D4r6G8mG6P44jQ3s4n7G16fDCL6Hwth2G1na"
            ] as Address[];
          } else {
            // Default to mainnet
            tipAccounts = [
              "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
              "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
              "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
              "ADaUMid9yfUytqMBgopwjb2DTLSokTYR2xAWhqq2eBfe",
              "DfXygSm4jcyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjv",
              "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwTc53",
              "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeMgRwbb5Qz",
              "FKrPkTwrBGPUUe6bQ4r7UqD9E8N8VwP6E2qL6Fk121y",
            ] as Address[];
          }

          const randomTipAccount = tipAccounts[Math.floor(Math.random() * tipAccounts.length)];
          const tipIx = getTransferSolInstruction({
            source: feePayer,
            destination: randomTipAccount!,
            amount: this.state.jitoTip,
          });
          return appendTransactionMessageInstruction(tipIx, tx);
        }
        return tx;
      }
    )

    if (lookupTables.length > 0) {
      const { fetchAddressLookupTable } = await import("@solana-program/address-lookup-table")
      const { compressTransactionMessageUsingAddressLookupTables } = await import("@solana/transaction-messages")
      
      const addressesByLookupTableAddress: Record<string, Address[]> = {}
      
      // Fetch lookup tables in parallel to minimize network latency
      await Promise.all(
        lookupTables.map(async (address) => {
          const { data: { addresses } } = await fetchAddressLookupTable(rpc as any, address)
          addressesByLookupTableAddress[address] = addresses
        })
      )

      message = compressTransactionMessageUsingAddressLookupTables(
        message as any,
        addressesByLookupTableAddress as any
      ) as any
    }

    return message
  }
}