# Changelog

## 0.1.1 — Jito, ALTs, and Token Metadata

- **Transactions upgraded to V0**: Transactions are natively built with `version: 0`.
- **Address Lookup Table (ALT) Support**: Added `.withAddressLookupTable(address)` modifier to `TxBuilder`.
- **Jito MEV Integration**: Added `.withJitoTip(lamports)` modifier to `TxBuilder`. Automatically routes through Jito Block Engine.
- **Native SOL Transfers**: Added `transferSol` to new `system` module.
- **Token Queries**: Added `getMintInfo`, `getTokenBalance`, and `getTokenBalanceByOwner` to `AuraClient`.
- **Token Metadata**: Added `getTokenMetadata` to manually parse Metaplex V1 metadata accounts.
- **PDA Utilities**: Added `findPda` helper.
- **TypeScript DX**: Fixed string collapsing on `ClusterInput` for better IDE autocomplete.
- **Refactoring**: Renamed `toLamports` to `toLamport` for API consistency.

## 0.1.0 — initial release

- connect() — fluent Solana client
- buildTx() — auto compute budget, retry, typed result
- Keypair utilities — loadKey, loadKeyFile, saveKeyFile
- Token helpers — mintToken, mintMore, transferToken, burnToken
- Typed error system — 7 error classes with codes