import { getProgramDerivedAddress } from "@solana/kit";
import type {Address, Signature, ReadonlyUint8Array} from "@solana/kit";
import type {ClusterMoniker, ClusterInput} from "./types.js"

/**
 * Helper to find a Program Derived Address (PDA).
 * Seeds can be Uint8Array buffers or regular strings.
 */
export async function findPda(programId: Address, seeds: (Uint8Array | ReadonlyUint8Array | string)[]): Promise<Address> {
  const parsedSeeds = seeds.map(s => typeof s === "string" ? new TextEncoder().encode(s) : s);
  const [pda] = await getProgramDerivedAddress({ programAddress: programId, seeds: parsedSeeds });
  return pda;
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Convert Lamports to SOL.
 * 
 * @example 
 * toSol(1_000_000_000n) -> 1
 * toSol(500_000_000) -> 0.5
 */
export function toSol(lamports: bigint, decimals = 9): number {
 const divisor = 10 ** decimals;
 return Number(lamports) / divisor;
}

/**
 * Convert SOL to Lamports
 * 
 * @xample
 * toLamport(1) -> 1_000_000_000n
 * toLamport(0.5) -> 500_000_000n
 */

export function toLamport(sol: number): bigint {
    return BigInt(Math.round(sol * Number(LAMPORTS_PER_SOL)));
}

/**
 * Public HTTP RPC URL for a cluster.
 */
export function rpcUrl(cluster: ClusterMoniker): string {
    const urls: Record<ClusterMoniker, string> = {
        mainnet: "https://api.mainnet-beta.solana.com",
        devnet: "https://api.devnet.solana.com",
        testnet: "https://api.testnet.solana.com",
        localnet: "http://localhost:8899",
    }

    return urls[cluster];
}



/**
 * WebSocket URL for a cluster.
 *
 * Why separate from rpcUrl?
 * HTTP = requests (getBalance, sendTransaction)
 * WebSocket = subscriptions (confirmTransaction, accountSubscribe)
 *
 * localnet uses ws:// not wss:// — no TLS cert on localhost.
 */

export function wsUrl(cluster: ClusterMoniker): string {
  const urls: Record<ClusterMoniker, string> = {
    mainnet: "wss://api.mainnet-beta.solana.com",
    devnet: "wss://api.devnet.solana.com",
    testnet: "wss://api.testnet.solana.com",
    localnet: "ws://localhost:8900",
  }
  return urls[cluster]
}

type ExplorerEntity = "tx" | "address" | "block";

/**
 * Build a Solana Explorer URL
 */

export function explorerUrl(
    value: Signature | Address | string,
    cluster: ClusterInput = "mainnet",
    entity: ExplorerEntity = "tx"
): string {
    const base = `https://explorer.solana.com/${entity}/${value}`;
    if (cluster == "mainnet") return base;
    if (cluster == "localnet") return `${base}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`;

    return `${base}?cluster=${cluster}`
}

/**
 * Truncate long address or signature for display.
 * 
 * @example
 * truncate("NANASIGHIJKLMNOPQRSTUVWXYZ") -> "NANA...WXYZ"
 */
export function truncate(value: string, chars=4): string {
    if(value.length <= chars * 2 + 3) return value;
    return `${value.slice(0, chars)}...${value.slice(-chars)}`
}

/**
 * Sleep for ms miliseconds
 * Used by the retry loop in send() - back off between attempts
 * @internal
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse Solana simulation logs into a human-readable error.
 * Raw logs look like: "Program log: Error: Unauthorized signer"
 * This extracts just the meaningful part.
 * @internal
 */
export function parseSimulationLogs(logs: string[]): string | null {
  for (const log of logs) {
    const customMatch = log.match(/Program log: Error: (.+)/)
    if (customMatch?.[1]) return customMatch[1]

    const anchorMatch = log.match(/Error Message: (.+)/)
    if (anchorMatch?.[1]) return anchorMatch[1]

    const systemMatch = log.match(
      /Transfer: insufficient lamports (\d+), need (\d+)/,
    )
    if (systemMatch?.[1] && systemMatch?.[2]) {
      return `Insufficient funds: have ${systemMatch[1]} lamports, need ${systemMatch[2]}`
    }
  }
  return null
}