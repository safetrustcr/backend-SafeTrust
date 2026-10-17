Wallet challenges are single-use and expire after five minutes. The API deletes
expired rows whenever it issues a new challenge; the `expires_at` index supports
this cleanup without scanning the table.

The challenge and verify endpoints return stable error codes:

- `WALLET_CHALLENGE_EXPIRED` (`401`): request a new challenge.
- `WALLET_CHALLENGE_ALREADY_USED_OR_UNKNOWN` (`409`): challenges cannot be replayed.
- `WALLET_ALREADY_REGISTERED` (`409`): the wallet is already bound to another UID.
- `UNSUPPORTED_STELLAR_ACCOUNT_TYPE` (`400`): only funded, single-key Ed25519
  accounts are accepted; contract addresses and multisig accounts are rejected.
