# Changelog

## 0.1.0 — Production Readiness Release

- **Dynamic Anchor Program Client**: Added dynamic runtime Anchor client wrapper (`client.loadProgram(programId, idl)`) powered by ES6 Proxies. Supports structured Borsh data encoding/decoding and active on-chain 8-byte account discriminator validation.
- **Adaptive Congestion-Aware Priority Fees**: Added `.withDynamicPriorityFee(level)` modifier to `TxBuilder`, automatically querying localized fee markets specifically for your transaction's read/written accounts and mapping percentiles (`low`, `medium`, `high`, `veryHigh`) with automated floors.
- **Comprehensive Token-2022 Support**: Upgraded `mintToken`, `mintMore`, `transferToken`, `burnToken`, `getAta`, and `getTokenBalanceByOwner` to accept an optional `tokenProgram` override (defaulting to legacy SPL Token). Exported `TOKEN_2022_PROGRAM_ADDRESS` constant.
- **Universal Browser Safety**: Guarded Node `process` references in `src/keypair.ts` to prevent bundler runtime crashes in frontend client contexts.
- **Robust Verification**: Added new test suites in `tests/priority.test.ts` and `tests/token2022.test.ts` to achieve 133 fully passing unit tests.
- **Corrected Asset Logo**: Updated corrected logo image spelling and paths in README.

## 0.0.2 — Initial Release

- **Transactions upgraded to V0**: Transactions are natively built with `version: 0`.
- **Address Lookup Table (ALT) Support**: Added `.withAddressLookupTable(address)` modifier to `TxBuilder`.
- **Jito MEV Integration**: Added `.withJitoTip(lamports)` modifier to `TxBuilder`. Automatically routes through Jito Block Engine.
- **Native SOL Transfers**: Added `transferSol` to new `system` module.
- **Token Queries**: Added `getMintInfo`, `getTokenBalance`, and `getTokenBalanceByOwner` to `InosukeClient`.
- **Token Metadata**: Added `getTokenMetadata` to manually parse Metaplex V1 metadata accounts.
- **PDA Utilities**: Added `findPda` helper.
- **TypeScript DX**: Fixed string collapsing on `ClusterInput` for better IDE autocomplete.
- **Refactoring**: Renamed `toLamports` to `toLamport` for API consistency.
- connect() — fluent Solana client
- buildTx() — auto compute budget, retry, typed result
- Keypair utilities — loadKey, loadKeyFile, saveKeyFile
- Token helpers — mintToken, mintMore, transferToken, burnToken
- Typed error system — 7 error classes with codes