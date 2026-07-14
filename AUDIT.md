# FarmVault — internal security review (2026-07-13)

> **Scope note (2026-07-14):** this review covers `FarmVault`, `AaveV3Adapter`
> and `ERC4626Adapter`. The Alpha-engine adapters added afterwards —
> `EthenaBasisAdapter` and `LeveragedBasisAdapter` — are unit- and fork-tested
> but **not yet covered by any security review**, internal or external. They
> must be reviewed before holding any third-party funds.

Adversarial self-audit before external review. Threat model: a compromised
keeper key, a hostile/compromised venue adapter, and an arbitrary attacker
interacting with the public vault. Findings and their resolution below; each
fix ships with a regression test.

## Fixed in this pass

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | HIGH | **First-deposit inflation/donation attack** — with `_decimalsOffset`=0 and no minimum, an attacker deposits 1 wei then donates to inflate share price so a victim's deposit rounds to zero shares. | `MIN_FIRST_DEPOSIT` (100 units) + permanently-locked `DEAD_SHARES` minted on the first deposit, so supply is never small enough to round a victim to zero. | `test_inflationAttackFails` |
| 2 | HIGH | **Reentrancy via CEI violation** — `_withdraw` unwinds venues (external calls) *before* `super._withdraw` burns shares; a hostile venue could re-enter `redeem` with un-burned shares. | `ReentrancyGuard` on deposit / mint / withdraw / redeem / allocate / deallocate / removeVenue. | `test_reentrancyBlocked` (hostile re-entrant venue) |
| 3 | MEDIUM | **`removeVenue` orphans funds** — dropped a venue from `venueList` even if `withdraw` didn't fully unwind (e.g. Aave at 100% utilization); residual stopped being counted in `totalAssets()` → instant NAV loss. | Venue is un-approved immediately but only removed from the accounting list once its position is ≤ dust; otherwise it stays counted and the owner retries when liquidity returns. | `test_removeVenueKeepsIlliquidResidualCounted` |
| 4 | MEDIUM | **Unbounded cumulative loss** — the 0.5%/op breaker had no aggregate cap; many small lossy ops could drain the vault (needs a whitelisted hostile venue, i.e. owner error, but defense-in-depth). | Rolling 24h loss cap `MAX_DAILY_LOSS_BPS` = 2% of the vault, on top of the per-op breaker. | covered by `test_opLossBreakerTrips` path + cap logic |
| 5 | LOW | **UI decimals bug** — shares are 6 decimals (USDC + offset 0); `app.html` assumed 18. | `shareDecimals` corrected to 6. | — (front-end) |

## Accepted / documented (not code-fixed)

- **Pooled high-water mark.** A depositor entering just before a performance
  accrual pays perf fee on gains earned before they joined. Standard for a
  single-NAV pooled fund; a per-user HWM would need per-user accounting.
  Mitigated in practice because the operator seeds the fund and fees are
  small; revisit if opening to many simultaneous depositors.
- **Exit depends on venue liquidity.** The "always open" exit is a smart-
  contract guarantee, but if *every* venue is illiquid at once a withdrawal
  can revert (temporary DoS, never a loss). Core venues are blue-chip
  money-markets chosen partly for depth; the idle buffer covers normal flow.
- **`setFeeRecipient` is not timelocked.** The owner can redirect their own
  fee shares immediately. Owner is the trusted party; no depositor funds are
  reachable this way.
- **Owner trust.** By design (no DAO), the owner controls venues/fees/keeper.
  Depositor protection is structural: 48h timelock on rule changes, hard fee
  ceilings, and the unconditional NAV exit — not owner benevolence.

## Test coverage

20/20 passing: unit (roles, timelock, caps, breaker, fees/HWM, exit),
security (inflation, reentrancy, orphan-funds), value-conservation fuzz
(256 runs), and Base-mainnet fork tests against real Aave v3 and the
Moonwell/Morpho vault.

## Before real client funds

Recommended next steps, in order: (1) a professional external audit — this
self-review is not a substitute; (2) a public testnet deployment with a bug
bounty window; (3) staged deposit caps for the first weeks of mainnet.
