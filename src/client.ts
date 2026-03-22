import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
} from "@solana/kit"
import type { IInstruction, TransactionSigner, Address, Signature } from "@solana/kit"
import { InvalidClusterError } from "./errors.js"
import { TxBuilder } from "./transaction.js"
import { rpcUrl, wsUrl } from "./utils.js"
import type {
  ClusterInput,
  ClusterMoniker,
  LatestBlockhash,
  SendOptions,
  SendResult,
} from "./types.js"

// ─── URL resolution ───────────────────────────────────────────────────────────

const VALID_MONIKERS = new Set<ClusterMoniker>([
  "mainnet",
  "devnet",
  "testnet",
  "localnet",
])

function isClusterMoniker(value: string): value is ClusterMoniker {
  return VALID_MONIKERS.has(value as ClusterMoniker)
}

/**
 * Resolve a cluster input (moniker or URL) into HTTP and WebSocket URLs.
 * Throws InvalidClusterError if the input is not valid.
 */
function resolveUrls(input: ClusterInput): {
  httpUrl: string
  wsEndpoint: string
} {
  // If it's a known moniker — resolve to public endpoints
  if (isClusterMoniker(input)) {
    return {
      httpUrl: rpcUrl(input),
      wsEndpoint: wsUrl(input),
    }
  }

  // Otherwise treat it as a raw URL — validate it
  try {
    const url = new URL(input)

    // Only HTTP/HTTPS is supported — not FTP, not file://, etc.
    if (!url.protocol.match(/^https?:/i)) {
      throw new InvalidClusterError(input)
    }

    // Derive WebSocket URL from HTTP URL
    // https://my-rpc.com → wss://my-rpc.com
    // http://localhost:8899 → ws://localhost:8899
    const wsUrl = new URL(input)
    wsUrl.protocol = wsUrl.protocol.replace("http", "ws")

    return {
      httpUrl: url.toString(),
      wsEndpoint: wsUrl.toString(),
    }
  } catch (e) {
    // new URL() throws if the string isn't a valid URL
    if (e instanceof InvalidClusterError) throw e
    throw new InvalidClusterError(input)
  }
}

// ─── LamportClient ────────────────────────────────────────────────────────────

/**
 * The main lamport client. All operations start here.
 * Create one with connect() — not with new LamportClient().
 *
 * Why a class? Because the client holds shared state —
 * the rpc connection, the cluster URL — that all operations need.
 * A class bundles that state with the methods that use it.
 */
export class LamportClient {
  // Public so advanced users can drop down to raw kit if needed
  readonly rpc: ReturnType<typeof createSolanaRpc>
  readonly rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>
  readonly cluster: ClusterInput

  constructor(
    rpc: ReturnType<typeof createSolanaRpc>,
    rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>,
    cluster: ClusterInput,
  ) {
    this.rpc = rpc
    this.rpcSubscriptions = rpcSubscriptions
    this.cluster = cluster
  }

  // ─── Transaction ────────────────────────────────────────────────────────────

  /**
   * Start building a transaction.
   * Returns a TxBuilder — chain .withPriorityFee(), .withComputeLimit(),
   * .withInstructions() off it, then call .send().
   *
   * @example
   * const result = await client
   *   .buildTx({ feePayer: signer, instructions: [myIx] })
   *   .withPriorityFee(1000n)
   *   .send()
   */
  buildTx(options: {
    feePayer: TransactionSigner
    instructions: IInstruction[]
    computeUnitLimit?: number
    computeUnitPrice?: bigint
    latestBlockhash?: LatestBlockhash
  }): TxBuilder {
    // Inject the RPC connections into the builder state
    // The builder needs them to simulate and send
    return new TxBuilder({
      feePayer: options.feePayer,
      instructions: options.instructions,
      computeUnitLimit: options.computeUnitLimit,
      computeUnitPrice: options.computeUnitPrice,
      latestBlockhash: options.latestBlockhash,
      rpc: this.rpc,
      rpcSubscriptions: this.rpcSubscriptions,
    })
  }

  /**
   * Send a pre-built TxBuilder directly.
   * For when you build elsewhere and just need reliable sending.
   *
   * @example
   * const builder = client.buildTx({...})
   * await client.send(builder)
   */
  async send(builder: TxBuilder, options?: SendOptions): Promise<SendResult> {
    return builder.send(options)
  }

  // ─── RPC helpers ────────────────────────────────────────────────────────────

  /**
   * Fetch the latest blockhash from the cluster.
   * Use withBlockhash() to pass this to a TxBuilder.
   *
   * @example
   * const bh = await client.recentBlockhash()
   * await client.buildTx({...}).withBlockhash(bh).send()
   */
  async recentBlockhash(): Promise<LatestBlockhash> {
    const result = await this.rpc
      .getLatestBlockhash({ commitment: "confirmed" })
      .send()
    return result.value
  }

  /**
   * Get the SOL balance of an address in lamports.
   *
   * @example
   * const lamports = await client.balance(signer.address)
   * console.log(toSol(lamports), "SOL")
   */
  async balance(address: Address): Promise<bigint> {
    const result = await this.rpc
      .getBalance(address, { commitment: "confirmed" })
      .send()
    return result.value
  }

  /**
   * Get minimum lamports needed for rent exemption.
   *
   * Why does this exist? When creating any account on Solana
   * you must deposit enough SOL to cover 2 years of rent.
   * The amount depends on how many bytes of data the account stores.
   *
   * @example
   * const rent = await client.rentFor(165) // token account = 165 bytes
   */
  async rentFor(dataSize: number): Promise<bigint> {
    const result = await this.rpc
      .getMinimumBalanceForRentExemption(BigInt(dataSize), {
        commitment: "confirmed",
      })
      .send()
    return result
  }

  /**
   * Airdrop SOL to an address.
   * Only works on devnet, testnet, and localnet — not mainnet.
   *
   * @example
   * await client.airdrop(signer.address, 1_000_000_000n) // 1 SOL
   */
  async airdrop(address: Address, lamports: bigint): Promise<Signature> {
    const signature = await this.rpc
      .requestAirdrop(address, lamports)
      .send()

    // Wait for the airdrop to confirm before returning
    // Otherwise code that follows immediately might not see the new balance
    const { value: latestBlockhash } = await this.rpc
      .getLatestBlockhash()
      .send()

    await this.rpc
      .confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        } as Parameters<typeof this.rpc.confirmTransaction>[0],
        { commitment: "confirmed" },
      )
      .send()

    return signature as Signature
  }
}

// ─── connect ──────────────────────────────────────────────────────────────────

/**
 * Connect to a Solana cluster and return a LamportClient.
 * This is the entry point for everything in lamport.
 *
 * @example
 * const client = connect("devnet")
 * const client = connect("mainnet")
 * const client = connect("localnet")
 * const client = connect("https://my-rpc.helius.xyz/api-key")
 */
export function connect(cluster: ClusterInput): LamportClient {
  if (!cluster) throw new InvalidClusterError(String(cluster))

  const { httpUrl, wsEndpoint } = resolveUrls(cluster)

  // createSolanaRpc — HTTP connection for requests
  const rpc = createSolanaRpc(httpUrl)

  // createSolanaRpcSubscriptions — WebSocket for confirmations
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsEndpoint)

  return new LamportClient(rpc, rpcSubscriptions, cluster)
}