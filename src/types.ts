import type {Address, Signature, Slot, TransactionSigner} from "@solana/kit";

/**
 * Four Solana Cluster
 */
export type ClusterMoniker = "mainnet" | "devnet" | "testnet" | "localnet";

/**
 * Anything you can pass to connect()
 * a known moniker or full URL
 */

export type ClusterInput = ClusterMoniker | string;

/**
 * processed - included in a block. Fast, can roll back.
 * confirmed - 2/3 validators agreed. Safe for almost everything.
 * finalized - permanent. Use for high value actions.
 */

export type Commitment = "processed" | "confirmed" | "finalized";

export interface SendResult {
    signature: Signature,
    slot: Slot,
    retries: number,
    commitment: Commitment
}

export interface SendOptions {
    // How many times to retry on blockhash expiry. Default: 3
    maxRetries?: number,
    // Commitment level to wait for. Default - "confirmed"
    commitment?: Commitment,
    // Skip simulation before sending. Default - false
    skipPreflight?: boolean
}

export interface LatestBlockhash {
    blockhash: string,
    lastValidBlockHeight: bigint
}

export interface MintTokenOptions {
    decimals: number,
    authority: TransactionSigner,
    freezeAuthority?: Address,
    mint?: TransactionSigner
}

export interface TransforTokenOptions {
    mint: Address,
    from: TransactionSigner,
    to: Address,
    amount: bigint,
    decimals: number
}

export interface BurnTokenOptions {
    mint: Address,
    owner: TransactionSigner,
    amount: bigint,
    decimals: number
}