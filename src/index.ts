/**
 * Inosuke — Solana TypeScript library
 *
 * @example
 * import { connect, loadKeyFile, toSol, explorerUrl } from 'inosuke'
 *
 * const client = connect("devnet")
 * const signer = await loadKeyFile("~/.config/solana/id.json")
 *
 * const result = await client
 *   .buildTx({ feePayer: signer, instructions: [...] })
 *   .withPriorityFee(1000n)
 *   .send()
 *
 * console.log(explorerUrl(result.signature, "devnet"))
 */


export { connect, InosukeClient } from "./client.js"
export { address } from "@solana/kit"
export type { Address, KeyPairSigner, Signature, Instruction } from "@solana/kit"


export { TxBuilder } from "./transaction.js"

export {
  generateKey,
  generateExtractableKey,
  loadKey,
  loadKeyFile,
  saveKeyFile,
  keyFromBytes,
  toBase58,
} from "./keypair.js"

// Token 
export {
  mintToken,
  mintMore,
  transferToken,
  burnToken,
  getAta,
  toRawAmount,
  toUiAmount,
  MINT_SIZE,
  TOKEN_ACCOUNT_SIZE,
} from "./token.js"

// System
export { transferSol } from "./system.js"
export type { TransferSolOptions } from "./system.js"

// Utils
export {
  toSol,
  toLamport,
  explorerUrl,
  rpcUrl,
  wsUrl,
  truncate,
  findPda,
  // parseSimulationLogs and sleep are internal — not exported
} from "./utils.js"

// Errors
export {
  InosukeError,
  SimulationError,
  ConfirmationError,
  BlockhashExpiredError,
  InsufficientFundsError,
  ComputeExceededError,
  InvalidClusterError,
  KeypairLoadError,
  KeypairSaveError,
  isInosukeError,
  hasErrorCode,
} from "./errors.js"

//  Types
export type {
  ClusterInput,
  ClusterMoniker,
  Commitment,
  SendResult,
  SendOptions,
  LatestBlockhash,
  MintTokenOptions,
  TransferTokenOptions,
  BurnTokenOptions,
} from "./types.js"