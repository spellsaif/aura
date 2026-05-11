# Changelog

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