import { describe, it, expect } from "vitest"
import {
  generateKey,
  loadKey,
  keyFromBytes,
  toBase58,
  loadKeyFile,
  saveKeyFile,
  generateExtractableKey,
} from "../src/keypair.js"
import { KeypairLoadError } from "../src/errors.js"
import { tmpdir } from "node:os"
import { join } from "node:path"


describe("generateKey", () => {
  it("returns a signer with an address", async () => {
    const signer = await generateKey()

    expect(signer.address).toBeDefined()
    expect(typeof signer.address).toBe("string")
    // Solana addresses are 32-44 characters in base58
    expect(signer.address.length).toBeGreaterThanOrEqual(32)
    expect(signer.address.length).toBeLessThanOrEqual(44)
  })

  it("generates unique keypairs every time", async () => {
    const a = await generateKey()
    const b = await generateKey()

    expect(a.address).not.toBe(b.address)
  })

  it("returns a signer with sign functions", async () => {
    const signer = await generateKey()

    // Kit signers must have these two functions
    expect(typeof signer.signMessages).toBe("function")
    expect(typeof signer.signTransactions).toBe("function")
  })
})

describe("toBase58 and loadKey", () => {
  it("round-trips: export then import restores same address", async () => {
    // Generate a fresh keypair
    const original = await generateExtractableKey()

    // Export the private key to base58
    const secret = await toBase58(original)

    // It should be a non-empty string
    expect(typeof secret).toBe("string")
    expect(secret.length).toBeGreaterThan(40)

    // Load it back
    const restored = await loadKey(secret)

    // The address must match — same private key = same public key = same address
    expect(restored.address).toBe(original.address)
  })

  it("toBase58 returns a different string than the address", async () => {
    const signer = await generateExtractableKey()
    const secret = await toBase58(signer)

    // The address is the PUBLIC key in base58
    // The secret is the PRIVATE key in base58
    // They are different bytes, so different strings
    expect(secret).not.toBe(signer.address)
  })
})

describe("loadKey", () => {
  it("throws KeypairLoadError for invalid base58", async () => {
    await expect(loadKey("not-valid-!!!")).rejects.toThrow(KeypairLoadError)
  })

  it("throws KeypairLoadError for empty string", async () => {
    await expect(loadKey("")).rejects.toThrow(KeypairLoadError)
  })

  it("error has the correct code", async () => {
    try {
      await loadKey("invalid")
    } catch (e) {
      expect(e).toBeInstanceOf(KeypairLoadError)
      if (e instanceof KeypairLoadError) {
        expect(e.code).toBe("KEYPAIR_LOAD_FAILED")
      }
    }
  })
})

describe("keyFromBytes", () => {
  it("round-trips with a generated keypair", async () => {
    const original = await generateExtractableKey()

    // Export private key bytes via pkcs8 (kit 6.x Ed25519 format)
    const pkcs8 = await crypto.subtle.exportKey(
      "pkcs8",
      original.keyPair.privateKey,
    )
    const privateBytes = new Uint8Array(pkcs8, pkcs8.byteLength - 32, 32)

    const publicBytes = await crypto.subtle.exportKey(
      "raw",
      original.keyPair.publicKey,
    )

    const combined = new Uint8Array(64)
    combined.set(privateBytes, 0)
    combined.set(new Uint8Array(publicBytes), 32)

    const restored = await keyFromBytes(combined)
    expect(restored.address).toBe(original.address)
  })

  it("throws KeypairLoadError for bytes that are too short", async () => {
    const badBytes = new Uint8Array(10)
    await expect(keyFromBytes(badBytes)).rejects.toThrow(KeypairLoadError)
  })
})


describe("saveKeyFile and loadKeyFile", () => {
  it("round-trips: save then load restores same address", async () => {
    // Generate a keypair
    const original = await generateExtractableKey()

    // Save to a temp file
    const tmpPath = join(tmpdir(), `lamport-test-${Date.now()}.json`)
    await saveKeyFile(original, tmpPath)

    // Load it back
    const restored = await loadKeyFile(tmpPath)

    expect(restored.address).toBe(original.address)
  })

  it("creates parent directories if they don't exist", async () => {
    const original = await generateExtractableKey()

    // Path with a non-existent subdirectory
    const tmpPath = join(
      tmpdir(),
      `lamport-test-${Date.now()}`,
      "nested",
      "keypair.json",
    )

    // Should not throw even though the dirs don't exist
    await expect(saveKeyFile(original, tmpPath)).resolves.toBeUndefined()

    // Should be loadable
    const restored = await loadKeyFile(tmpPath)
    expect(restored.address).toBe(original.address)
  })
})

describe("loadKeyFile errors", () => {
  it("throws KeypairLoadError when file does not exist", async () => {
    await expect(
      loadKeyFile("/this/path/does/not/exist.json"),
    ).rejects.toThrow(KeypairLoadError)
  })

  it("error message contains the file path", async () => {
    const badPath = "/this/path/does/not/exist.json"
    try {
      await loadKeyFile(badPath)
    } catch (e) {
      expect(e).toBeInstanceOf(KeypairLoadError)
      if (e instanceof KeypairLoadError) {
        expect(e.message).toContain(badPath)
        expect(e.path).toBe(badPath)
      }
    }
  })
})