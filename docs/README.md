# SafeTrust Backend Documentation

Documentation for SafeTrust backend architecture and escrow flows.

> **Implementation status:** The escrow flow pages are marked
> **Planned — post-Issue-03 behavior** because this checkout has not yet
> migrated its route implementation to polling-based transaction flows.

## Architecture

| Document | Description |
|---|---|
| [Architecture Overview](architecture/overview.md) | Planned frontend, wallet, Trustless Work, and polling responsibilities for escrow transactions |

## Stellar and escrow flows

| Document | Description |
|---|---|
| [Fund Escrow](stellar/fund-escrow.md) | Planned unsigned-XDR, wallet-signing, submission, and polling flow for funding |
| [Approve Milestone](stellar/approve-milestone.md) | Planned milestone approval route and indexer reconciliation |
| [Release Funds](stellar/release-funds.md) | Planned release route, Trustless Work transaction endpoint, and polling behavior |
| [Dispute and Resolve](stellar/dispute-resolve.md) | Planned dispute and resolution transaction flows and reconciliation |
| [Trustless Work Indexer](stellar/trustless-work-indexer.md) | V1 indexer endpoint, scheduled polling, and local state reconciliation |
