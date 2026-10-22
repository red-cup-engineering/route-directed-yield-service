# route-directed-yield-service

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

Tidepool's directed-yield routing: reads a member's Morpho vault position through
`@red-cup-engineering/treasury-observation-service`, computes the accrued shares to redeem
(never principal), and emits one routing intent -- `{paper, mandate, transactions, amounts,
sources}`, the same paper-intent shape `pool-service`'s `front-pool-draw.mjs` uses for Hive
transfers. The Moonwell WELL claim is the first-cycle special case (`scripts/claim-first-cycle-rewards.mjs`).

## What this section owns

- `src/intent.mjs` -- pure EVM-call encoders (`redeem`, ERC-20 `transfer`, the deployed helper's
  `redeemAndForward`, Moonwell's Comptroller `claimReward`) and the intent-record shape.
- `src/mandate-execution.mjs` -- the one path either script uses to check a mandate, sign with
  `@red-cup-engineering/key-management-services-section`'s `sign-with-wallet`, optionally
  broadcast, and journal a receipt. Only a single atomic transaction is ever signed here; two
  separate calls (no deployed helper) always stay paper, since they cannot be made atomic from
  outside a contract.
- `scripts/route-directed-yield.mjs` -- `{memberAddress, vault, principalAssets, poolAddress,
  cycleId, chainId?, mandate?, contractAddress?}` in, one routing intent out.
- `scripts/claim-first-cycle-rewards.mjs` -- the org's own Moonwell WELL claim, the same intent
  shape, `{holderAddress, comptroller, distributor, wellToken, poolAddress, cycleId, mandate?}` in.
- `lib/contracts/route-directed-yield.sol` -- `RouteDirectedYield`, the stateless on-chain helper
  that redeems accrued ERC-4626 shares and forwards the assets to the pool in one call. Tested
  through `ethereum-services-section`'s existing Foundry toolchain
  (`test/RouteDirectedYield.t.sol` there imports this file via its published npm dependency, the
  same pattern `semiotic-exchange-chain-services-section/lib/contracts/SemioticExchange.sol` uses).

## Mandate limitation (filed as a friction against key-management-services-section)

`checkMandateAllows` bounds an EVM mandate by allowed-contract set and native `valueWei` ceiling
only; it does not decode calldata to bound an ERC-20 token amount. A `redeem`/`transfer`/
`claimReward` call always carries `valueWei: "0"`, so today's mandate cannot itself cap how much
of a token a call moves -- only which contracts it may call. `attemptMandateExecution` uses the
mandate exactly as it exists; the amount ceiling for a live cycle is therefore an operational
control (a per-cycle mandate scoped to one call), not yet a mandate-enforced one.

## Tests

`npm test` runs `node --test test/*.test.mjs`: pure encoder tests, `attemptMandateExecution`
against a temporary keystore (mirrors key-management's own `sign-with-wallet.test.mjs` pattern),
and both scripts against an injected `fetchImpl` RPC fake. No test touches a real network or key.
