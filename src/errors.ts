
/**
 * Every Inosuke erros extends this base class.
 * 
 * @example
 * catch(e) {
 *      if(e instanceof InosukeError) {
 *          console.log(e.code) // SIMULATION FAILED 
 *  }
 * }
 */

export class InosukeError extends Error {
    readonly code: string;

    constructor(code: string, message: string, options?: ErrorOptions) {
        super(message, options);

        this.name = "InosukeError";
        this.code = code;
        
        if (Error.captureStackTrace) {
          Error.captureStackTrace(this, this.constructor)
        }
    }


}

/**
 * Thrown when transaction simulation detects the tx will fail on-chain.
 *
 * This happens BEFORE the transaction is sent — we catch it early
 * so you don't waste a real transaction fee on something that will fail.
 *
 * The `logs` field contains the raw program logs from simulation.
 * These are what you see in the Explorer when a tx fails.
 *
 * @example
 * catch (e) {
 *   if (e instanceof SimulationError) {
 *     console.log(e.message) // human-readable reason
 *     console.log(e.logs)    // raw program logs for debugging
 *   }
 * }
 */
export class SimulationError extends InosukeError {
  readonly logs: string[]

  constructor(message: string, logs: string[], options?: ErrorOptions) {
    super("SIMULATION_FAILED", message, options)
    this.name = "SimulationError"
    this.logs = logs
  }
}

/**
 * Thrown when a transaction was sent but we timed out waiting for confirmation.
 *
 * Important: the transaction might still land eventually.
 * We preserve the signature so you can check it manually on the explorer.
 *
 * @example
 * catch (e) {
 *   if (e instanceof ConfirmationError) {
 *     console.log(`Check manually: ${e.signature}`)
 *   }
 * }
 */
export class ConfirmationError extends InosukeError {
  readonly signature: string

  constructor(signature: string, options?: ErrorOptions) {
    super(
      "CONFIRMATION_TIMEOUT",
      `Transaction ${signature} was sent but confirmation timed out. ` +
        `Check the signature on the explorer — it may still land.`,
      options,
    )
    this.name = "ConfirmationError"
    this.signature = signature
  }
}

/**
 * Thrown when the blockhash expired before the transaction was confirmed.
 *
 * Blockhashes are valid for ~60 seconds (~150 blocks).
 * This happens when:
 * - Network is congested and your tx keeps getting dropped
 * - You built the tx and waited too long before sending
 * - All retries failed with expired blockhashes
 *
 * inosuke's .send() retries automatically on blockhash expiry.
 * This error only throws when ALL retries are exhausted.
 */

export class BlockhashExpiredError extends InosukeError {
  constructor(options?: ErrorOptions) {
    super(
      "BLOCKHASH_EXPIRED",
      "The blockhash expired before the transaction confirmed. " +
        "Rebuild the transaction with a fresh blockhash and retry.",
      options,
    )
    this.name = "BlockhashExpiredError"
  }
}

/**
 * Thrown when the fee payer doesn't have enough SOL.
 *
 * We carry required and available as bigints so you can
 * display them, calculate the shortfall, or auto-fund in tests.
 *
 * @example
 * catch (e) {
 *   if (e instanceof InsufficientFundsError) {
 *     const shortfall = e.required - e.available
 *     await client.airdrop(feePayer.address, shortfall)
 *   }
 * }
 */
export class InsufficientFundsError extends InosukeError {
  readonly required: bigint
  readonly available: bigint

  constructor(required: bigint, available: bigint, options?: ErrorOptions) {
    super(
      "INSUFFICIENT_FUNDS",
      `Fee payer has ${available} lamports but needs ${required}. ` +
        `Fund the account with at least ${required - available} more lamports.`,
      options,
    )
    this.name = "InsufficientFundsError"
    this.required = required
    this.available = available
  }
}

/**
 * Thrown when a transaction exceeds its compute unit budget.
 *
 * inosuke auto-sets compute budgets via simulation, so this
 * usually means the program took an unexpected code path that
 * uses more CUs than the simulated path did.
 */
export class ComputeExceededError extends InosukeError {
  readonly unitsUsed: number
  readonly unitsLimit: number

  constructor(unitsUsed: number, unitsLimit: number, options?: ErrorOptions) {
    super(
      "COMPUTE_EXCEEDED",
      `Transaction used ${unitsUsed} compute units but limit was ${unitsLimit}. ` +
        `The program took an unexpected code path.`,
      options,
    )
    this.name = "ComputeExceededError"
    this.unitsUsed = unitsUsed
    this.unitsLimit = unitsLimit
  }
}


/**
 * Thrown when connect() receives a bad cluster moniker or URL.
 *
 * We store what the user provided so the error message
 * can show them exactly what was wrong.
 */
export class InvalidClusterError extends InosukeError {
  readonly provided: string

  constructor(provided: string, options?: ErrorOptions) {
    super(
      "INVALID_CLUSTER",
      `"${provided}" is not a valid cluster. ` +
        `Use "mainnet", "devnet", "testnet", "localnet", or a full RPC URL.`,
      options,
    )
    this.name = "InvalidClusterError"
    this.provided = provided
  }
}

/**
 * Thrown when a keypair can't be loaded.
 * Covers file not found, invalid JSON, wrong byte length, etc.
 *
 * We store the path so the error message tells you exactly
 * which file failed — not just "something went wrong."
 */
export class KeypairLoadError extends InosukeError {
  readonly path: string

  constructor(path: string, cause?: unknown, options?: ErrorOptions) {
    super(
      "KEYPAIR_LOAD_FAILED",
      `Could not load keypair from "${path}". ` +
        `Make sure the file exists and contains a valid JSON byte array.`,
      { cause, ...options },
    )
    this.name = "KeypairLoadError"
    this.path = path
  }
}

/**
 * Thrown when a keypair can't be saved.
 */
export class KeypairSaveError extends InosukeError {
  readonly path: string

  constructor(path: string, cause?: unknown, options?: ErrorOptions) {
    super(
      "KEYPAIR_SAVE_FAILED",
      `Could not save keypair to "${path}". ` +
        `Make sure the directory is writable, and the key is extractable (use generateExtractableKey()).`,
      { cause, ...options },
    )
    this.name = "KeypairSaveError"
    this.path = path
  }
}

/**
 * Type guard — narrows unknown to InosukeError.
 *
 * Why do we need this? In catch blocks, the error is typed as `unknown`
 * in strict TypeScript. You can't access .code without narrowing first.
 *
 * @example
 * catch (e) {
 *   if (isInosukeError(e)) {
 *     console.log(e.code) // TypeScript now knows e is InosukeError
 *   }
 * }
 */
export function isInosukeError(e: unknown): e is InosukeError {
  return e instanceof InosukeError;
}

/**
 * Type guard — narrows unknown to a InosukeError with a specific code.
 *
 * Use this when you want to handle one specific error type
 * without importing the error class itself.
 *
 * @example
 * catch (e) {
 *   if (hasErrorCode(e, "BLOCKHASH_EXPIRED")) {
 *     // TypeScript knows e.code === "BLOCKHASH_EXPIRED"
 *   }
 * }
 */
export function hasErrorCode(
  e: unknown,
  code: string,
): e is InosukeError & { code: typeof code } {
  return isInosukeError(e) && e.code === code
}