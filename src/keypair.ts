
import { createKeyPairFromBytes, createKeyPairSignerFromBytes, generateKeyPairSigner, getBase58Decoder, getBase58Encoder, type KeyPairSigner } from "@solana/kit";
import { KeypairLoadError } from "./errors.js";

/**
 * Generate a new random keypair signer.
 * Every call produces completely new keypair.
 * 
 * @example
 * const signer = await generateKey();
 * console.log(signer.address)  -> "nanasi...xyz"
 */

export async function generateKey(): Promise<KeyPairSigner> {
    // Just wrapping @solana/kit generateKeyPairSigner()
    return generateKeyPairSigner();
}

/**
 * Load keypair signer from based58-encoded secret key string.
 * 
 * @example
 * const signer = await loadKey(process.env.SECRET_KEY);
 */
export async function loadKey(base58SecretKey: string): Promise<KeyPairSigner> {
    try{
        // Decode base58 string to raw bytes
        const bytes = getBase58Encoder().encode(base58SecretKey);

        // Create a signer from those raw bytes.
        // The bytes must be 64 bytes: 32 private + 32 public.
        return await createKeyPairSignerFromBytes(bytes);
    } catch(e) {
         
        throw new KeypairLoadError("<base58 string>", e);
    }
}

/**
 * Load a keypair signer from a JSON file.
 * 
 * Compatible with Solana CLI keypair files.
 * Default location: ~/.config/solana/id.json
 * 
 * Only works in Node.js, not available for browsers.
 * 
 * @example 
 * const signer = await loadKeyFile("~/.config/solana/id.json");
 * const signer = await loadKeyFile("./my-keypair.json");
 */
export async function loadKeyFile(path: string): Promise<KeyPairSigner> {
     // Resolve ~ to the home directory
     // process.env.HOME works on Mac/Linux
     // process.env.USERPROFILE works on Windows
    const resolvedPath = path.replace(
        /^~/,
        process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~",
    )

    try {
        // Dynamic import — this keeps the import inside the function
        const {readFile} = await import("node:fs/promises");
        const raw = await readFile(resolvedPath, "utf-8");

        // Parse the JSON - should be an array of numbers
        const parsed: unknown = JSON.parse(raw);

        if(!Array.isArray(parsed)) {
            throw new Error(
                `Keypair file must contain a JSON array of numbers, got: ${typeof parsed}` 
            );
        }

        // Convert number[] -> Unit8Array
        // Unit8Array is what kit's createKeyPairSignerFromBytes expects.
        const bytes = new Uint8Array(parsed as number[]);

        return await createKeyPairSignerFromBytes(bytes);

    } catch(e) {
        if (e instanceof KeypairLoadError) throw e;
            
        throw new KeypairLoadError(resolvedPath, e);
    }
}


/**
 * Save a keypair signer to a JSON file.
 *
 * Output is compatible with the Solana CLI —
 * you can use the file with `solana --keypair ./my-keypair.json`
 *
 * Only works in Node.js.
 *
 * @example
 * const signer = await generateKey()
 * await saveKeyFile(signer, "./my-keypair.json")
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

    // Export raw bytes from the CryptoKey objects
    // CryptoKey is opaque — you can't access bytes directly,
    // you must call crypto.subtle.exportKey()
    // "raw" format = just the bytes, no encoding or wrapping
    const privateKeyBytes = await crypto.subtle.exportKey(
      "raw",
      signer.keyPair.privateKey,
    )
    const publicKeyBytes = await crypto.subtle.exportKey(
      "raw",
      signer.keyPair.publicKey,
    )

    // Solana CLI format: 64-byte array (32 private + 32 public)
    const combined = new Uint8Array(64)
    combined.set(new Uint8Array(privateKeyBytes), 0)   // private at offset 0
    combined.set(new Uint8Array(publicKeyBytes), 32)   // public at offset 32

    // Create the directory if it doesn't exist
    // recursive: true means no error if dir already exists
    await mkdir(dirname(resolvedPath), { recursive: true })

    // Write as JSON array of numbers — the Solana CLI format
    await writeFile(resolvedPath, JSON.stringify(Array.from(combined)))
  } catch (cause) {
    throw new KeypairLoadError(resolvedPath, cause)
  }
}

/**
 * Create a signer from a raw Uint8Array (64 bytes).
 *
 * Use this when you have the bytes in memory already
 * and don't need to read from a file or base58 string.
 *
 * @example
 * const bytes = new Uint8Array([174, 47, 154, ...]) // 64 bytes
 * const signer = await keyFromBytes(bytes)
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
 *
 * Use this to store a keypair in an environment variable.
 * The output can be passed back to loadKey() to restore the signer.
 *
 *
 * @example
 * const signer = await generateKey()
 * const secret = await toBase58(signer)
 * // store in .env: SECRET_KEY=<secret>
 *
 * // Later, restore it:
 * const restored = await loadKey(process.env.SECRET_KEY!)
 * restored.address === signer.address // true
 */
export async function toBase58(signer: KeyPairSigner): Promise<string> {
  // Export the private key bytes
  const privateKeyBytes = await crypto.subtle.exportKey(
    "raw",
    signer.keyPair.privateKey,
  )

  // Encode bytes → base58 string
  // getBase58Decoder().decode() = bytes → base58 string
  return getBase58Decoder().decode(new Uint8Array(privateKeyBytes))
}
