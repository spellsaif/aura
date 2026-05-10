import {describe, it, expect} from "vitest";
import {toSol, toLamport, rpcUrl, wsUrl, explorerUrl, parseSimulationLogs, truncate, findPda} from "./../src/utils.js";
import { address } from "@solana/kit";

describe("toSol", () => {
    it("converts 1 SOL worth of lamports", () => {
        expect(toSol(1_000_000_000n)).toBe(1);
    })


  it("converts fractional amounts", () => {
    expect(toSol(500_000_000n)).toBe(0.5)
  })

  it("handles zero", () => {
    expect(toSol(0n)).toBe(0)
  })
})

describe("toLamport", () => {
  it("converts 1 SOL", () => {
    expect(toLamport(1)).toBe(1_000_000_000n)
  })

  it("converts fractional SOL", () => {
    expect(toLamport(0.5)).toBe(500_000_000n)
  })

  it("handles 0.1 + 0.2 floating point edge case", () => {
    // Without Math.round this gives the wrong answer
    expect(toLamport(0.1 + 0.2)).toBe(300_000_000n)
  })

  it("round trips with toSol", () => {
    expect(toSol(toLamport(1.5))).toBeCloseTo(1.5)
  })
})

describe("rpcUrl", () => {
  it("returns mainnet URL", () => {
    expect(rpcUrl("mainnet")).toBe("https://api.mainnet-beta.solana.com")
  })

  it("returns devnet URL", () => {
    expect(rpcUrl("devnet")).toBe("https://api.devnet.solana.com")
  })

  it("returns http for localnet — no TLS on localhost", () => {
    expect(rpcUrl("localnet")).toMatch(/^http:\/\//)
  })
})

describe("wsUrl", () => {
  it("returns wss for public clusters", () => {
    expect(wsUrl("mainnet")).toMatch(/^wss:\/\//)
    expect(wsUrl("devnet")).toMatch(/^wss:\/\//)
  })

  it("returns ws (not wss) for localnet", () => {
    expect(wsUrl("localnet")).toMatch(/^ws:\/\//)
    expect(wsUrl("localnet")).not.toMatch(/^wss:\/\//)
  })
})

describe("explorerUrl", () => {
  const sig = "nan457x"

  it("mainnet has no cluster param", () => {
    expect(explorerUrl(sig, "mainnet")).toBe(
      `https://explorer.solana.com/tx/${sig}`,
    )
  })

  it("devnet adds cluster param", () => {
    expect(explorerUrl(sig, "devnet")).toContain("?cluster=devnet")
  })

  it("localnet uses custom cluster format", () => {
    const url = explorerUrl(sig, "localnet")
    expect(url).toContain("cluster=custom")
    expect(url).toContain("customUrl")
  })

  it("defaults to tx entity", () => {
    expect(explorerUrl(sig)).toContain("/tx/")
  })
})

describe("truncate", () => {
  it("truncates long strings", () => {
    expect(truncate("NANASIGHIJKLMNOPQRSTUVWXYZ")).toBe("NANA...WXYZ")
  })

  it("leaves short strings alone", () => {
    expect(truncate("ABC")).toBe("ABC")
  })
})

describe("parseSimulationLogs", () => {
  it("extracts custom program errors", () => {
    const logs = ["Program log: Error: Unauthorized signer"]
    expect(parseSimulationLogs(logs)).toBe("Unauthorized signer")
  })

  it("returns null for clean logs", () => {
    expect(parseSimulationLogs(["Program 111 success"])).toBeNull()
  })

  it("returns null for empty logs", () => {
    expect(parseSimulationLogs([])).toBeNull()
  })
})

describe("findPda", () => {
  it("derives correct PDA for metadata program", async () => {
    const { getAddressEncoder } = await import("@solana/kit");
    const metaplexProgramId = address("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
    const mint = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC
    
    // Using string for prefix, and getAddressEncoder for pubkeys
    const pda = await findPda(metaplexProgramId, [
      "metadata",
      getAddressEncoder().encode(metaplexProgramId),
      getAddressEncoder().encode(mint)
    ]);

    expect(pda).toBe("5x38Kp4hvdomTCnCrAny4UtMUt5rQBdB6px2K1Ui45Wq");
  })
})