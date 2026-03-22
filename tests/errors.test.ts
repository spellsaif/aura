import { describe, it, expect } from "vitest"
import {
  AuraError,
  SimulationError,
  ConfirmationError,
  BlockhashExpiredError,
  InsufficientFundsError,
  ComputeExceededError,
  InvalidClusterError,
  KeypairLoadError,
  isAuraError,
  hasErrorCode,
} from "../src/errors.js"

describe("AuraError", () => {
  it("has correct name, code and message", () => {
    const e = new AuraError("TEST_CODE", "test message")
    expect(e.name).toBe("AuraError")
    expect(e.code).toBe("TEST_CODE")
    expect(e.message).toBe("test message")
  })

  it("is an instance of Error", () => {
    // This matters — try/catch only catches Error instances in some environments
    const e = new AuraError("X", "y")
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(AuraError)
  })

  it("has a stack trace", () => {
    const e = new AuraError("X", "y")
    expect(e.stack).toBeDefined()
    expect(e.stack).toContain("AuraError")
  })
})


describe("SimulationError", () => {
  it("has correct code", () => {
    const e = new SimulationError("failed", [])
    expect(e.code).toBe("SIMULATION_FAILED")
  })

  it("stores logs", () => {
    const logs = ["Program log: Error: Unauthorized"]
    const e = new SimulationError("failed", logs)
    expect(e.logs).toEqual(logs)
  })

  it("is instanceof AuraError", () => {
    // Subclasses should be catchable as AuraError
    const e = new SimulationError("failed", [])
    expect(e).toBeInstanceOf(AuraError)
  })

  it("is instanceof SimulationError", () => {
    const e = new SimulationError("failed", [])
    expect(e).toBeInstanceOf(SimulationError)
  })
})

describe("ConfirmationError", () => {
  it("stores the signature", () => {
    const sig = "4xK2abc"
    const e = new ConfirmationError(sig)
    expect(e.signature).toBe(sig)
  })

  it("includes signature in message", () => {
    const sig = "4xK2abc"
    const e = new ConfirmationError(sig)
    // The message should tell you exactly what to look up
    expect(e.message).toContain(sig)
  })

  it("has correct code", () => {
    const e = new ConfirmationError("sig")
    expect(e.code).toBe("CONFIRMATION_TIMEOUT")
  })
})

describe("BlockhashExpiredError", () => {
  it("has correct code", () => {
    const e = new BlockhashExpiredError()
    expect(e.code).toBe("BLOCKHASH_EXPIRED")
  })

  it("message explains what to do", () => {
    const e = new BlockhashExpiredError()
    expect(e.message).toContain("blockhash")
    expect(e.message).toContain("fresh")
  })
})

describe("InsufficientFundsError", () => {
  it("stores required and available as bigints", () => {
    const e = new InsufficientFundsError(1_000_000n, 500_000n)
    expect(e.required).toBe(1_000_000n)
    expect(e.available).toBe(500_000n)
  })

  it("includes both values in message", () => {
    const e = new InsufficientFundsError(1_000_000n, 500_000n)
    expect(e.message).toContain("1000000")
    expect(e.message).toContain("500000")
  })

  it("has correct code", () => {
    const e = new InsufficientFundsError(1n, 0n)
    expect(e.code).toBe("INSUFFICIENT_FUNDS")
  })
})


describe("ComputeExceededError", () => {
  it("stores units used and limit", () => {
    const e = new ComputeExceededError(250_000, 200_000)
    expect(e.unitsUsed).toBe(250_000)
    expect(e.unitsLimit).toBe(200_000)
  })

  it("has correct code", () => {
    const e = new ComputeExceededError(250_000, 200_000)
    expect(e.code).toBe("COMPUTE_EXCEEDED")
  })
})


describe("InvalidClusterError", () => {
  it("stores what was provided", () => {
    const e = new InvalidClusterError("badcluster")
    expect(e.provided).toBe("badcluster")
  })

  it("includes the bad value in message", () => {
    const e = new InvalidClusterError("badcluster")
    expect(e.message).toContain("badcluster")
  })

  it("message lists valid options", () => {
    const e = new InvalidClusterError("x")
    expect(e.message).toContain("mainnet")
    expect(e.message).toContain("devnet")
  })
})


describe("KeypairLoadError", () => {
  it("stores the file path", () => {
    const e = new KeypairLoadError("/bad/path.json")
    expect(e.path).toBe("/bad/path.json")
  })

  it("includes the path in the message", () => {
    const e = new KeypairLoadError("/bad/path.json")
    expect(e.message).toContain("/bad/path.json")
  })

  it("wraps the original cause", () => {
    const cause = new Error("file not found")
    const e = new KeypairLoadError("/path.json", cause)
    // ES2022 error chaining — original error accessible via .cause
    expect(e.cause).toBe(cause)
  })
})


describe("isAuraError", () => {
  it("returns true for AuraError", () => {
    expect(isAuraError(new AuraError("X", "y"))).toBe(true)
  })

  it("returns true for any subclass", () => {
    expect(isAuraError(new SimulationError("x", []))).toBe(true)
    expect(isAuraError(new BlockhashExpiredError())).toBe(true)
    expect(isAuraError(new InvalidClusterError("x"))).toBe(true)
  })

  it("returns false for plain Error", () => {
    expect(isAuraError(new Error("plain"))).toBe(false)
  })

  it("returns false for non-errors", () => {
    expect(isAuraError("string")).toBe(false)
    expect(isAuraError(null)).toBe(false)
    expect(isAuraError(undefined)).toBe(false)
    expect(isAuraError(42)).toBe(false)
    expect(isAuraError({})).toBe(false)
  })
})


describe("hasErrorCode", () => {
  it("matches the correct code", () => {
    const e = new BlockhashExpiredError()
    expect(hasErrorCode(e, "BLOCKHASH_EXPIRED")).toBe(true)
  })

  it("does not match a different code", () => {
    const e = new BlockhashExpiredError()
    expect(hasErrorCode(e, "SIMULATION_FAILED")).toBe(false)
  })

  it("returns false for non-LamportErrors", () => {
    expect(hasErrorCode(new Error("plain"), "BLOCKHASH_EXPIRED")).toBe(false)
    expect(hasErrorCode(null, "BLOCKHASH_EXPIRED")).toBe(false)
    expect(hasErrorCode("string", "BLOCKHASH_EXPIRED")).toBe(false)
  })
})