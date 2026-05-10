import {
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  getBase58Decoder,
  getBase58Encoder,
  createSignerFromKeyPair,
} from "@solana/kit"
import type { KeyPairSigner } from "@solana/kit"
import { KeypairLoadError, KeypairSaveError } from "./errors.js"

/**
 * Generate a new random keypair signer.
 * Keys are non-extractable by default — more secure.
 * Use generateExtractableKey() if you need toBase58() or saveKeyFile().
 */
export async function generateKey(): Promise<KeyPairSigner> {
  return generateKeyPairSigner()
}

/**
 * Generate a keypair signer whose private key CAN be exported.
 * Required for toBase58() and saveKeyFile().
 *
 * Uses Web Crypto directly with extractable: true
 */
export async function generateExtractableKey(): Promise<KeyPairSigner> {
  // Generate extractable key pair using Web Crypto directly
  const cryptoKeyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,           // extractable = true
    ["sign", "verify"],
  ) as CryptoKeyPair

  return createSignerFromKeyPair(cryptoKeyPair)
}

/**
 * Load keypair signer from base58-encoded secret key string.
 */
export async function loadKey(base58SecretKey: string): Promise<KeyPairSigner> {
  try {
    const bytes = getBase58Encoder().encode(base58SecretKey)
    return await createKeyPairSignerFromBytes(bytes)
  } catch (e) {
    throw new KeypairLoadError("<base58 string>", e)
  }
}

/**
 * Load a keypair signer from a JSON file.
 * Compatible with Solana CLI keypair files (~/.config/solana/id.json).
 * Only works in Node.js.
 */
export async function loadKeyFile(path: string): Promise<KeyPairSigner> {
  const resolvedPath = path.replace(
    /^~/,
    process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~",
  )
  try {
    const { readFile } = await import("node:fs/promises")
    const raw = await readFile(resolvedPath, "utf-8")
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error(
        `Keypair file must contain a JSON array of numbers, got: ${typeof parsed}`,
      )
    }
    const bytes = new Uint8Array(parsed as number[])
    return await createKeyPairSignerFromBytes(bytes)
  } catch (e) {
    if (e instanceof KeypairLoadError) throw e
    throw new KeypairLoadError(resolvedPath, e)
  }
}

/**
 * Save a keypair signer to a JSON file.
 * Output is compatible with the Solana CLI.
 * Only works with extractable keys (generateExtractableKey()).
 * Only works in Node.js.
 */
export async function saveKeyFile(
  signer: KeyPairSigner,
  filePath: string,
): Promise<void> {
  const resolvedPath = filePath.replace(
    /^~/,
    process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~",
  )
  try {
    const { writeFile, mkdir } = await import("node:fs/promises")
    const { dirname } = await import("node:path")

    // kit 6.x: Ed25519 private keys must be exported as pkcs8
    // The last 32 bytes of a pkcs8 export are the private key bytes
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", signer.keyPair.privateKey)
    const privateKeyBytes = new Uint8Array(pkcs8, pkcs8.byteLength - 32, 32)

    const publicKeyBytes = await crypto.subtle.exportKey("raw", signer.keyPair.publicKey)

    // Solana CLI format: 64 bytes (32 private + 32 public)
    const combined = new Uint8Array(64)
    combined.set(privateKeyBytes, 0)
    combined.set(new Uint8Array(publicKeyBytes), 32)

    await mkdir(dirname(resolvedPath), { recursive: true })
    await writeFile(resolvedPath, JSON.stringify(Array.from(combined)))
  } catch (cause) {
    throw new KeypairSaveError(resolvedPath, cause)
  }
}

/**
 * Create a signer from raw 64 bytes.
 */
export async function keyFromBytes(bytes: Uint8Array): Promise<KeyPairSigner> {
  try {
    return await createKeyPairSignerFromBytes(bytes)
  } catch (e) {
    throw new KeypairLoadError("<bytes>", e)
  }
}

/**
 * Export a signer's private key as a base58 string.
 * Only works with extractable keys (generateExtractableKey()).
 */
export async function toBase58(signer: KeyPairSigner): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", signer.keyPair.privateKey)
  const privateKeyBytes = new Uint8Array(pkcs8, pkcs8.byteLength - 32, 32)
  const publicKeyBytes = await crypto.subtle.exportKey("raw", signer.keyPair.publicKey)

  const combined = new Uint8Array(64)
  combined.set(privateKeyBytes, 0)
  combined.set(new Uint8Array(publicKeyBytes), 32)

  return getBase58Decoder().decode(combined)
}