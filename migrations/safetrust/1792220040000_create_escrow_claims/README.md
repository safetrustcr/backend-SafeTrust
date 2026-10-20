Escrow claims are written complaints about a released deposit (damage found
later, a wrong deduction, a missing refund). Rows are created only through
`POST /api/escrow-claims/:escrowId`; Hasura exposes read access to participants
and status updates to admins, and no client insert.

`(author_id, client_op_id)` is unique, so a retry with the same `clientOpId`
returns the original claim. The API allows at most five claims per author per
escrow in a rolling 24 hours.

The endpoints return stable error codes:

- `INVALID_CLAIM_BODY` (`400`): `body` must be a string of 10 to 2000 characters after trimming.
- `INVALID_CLAIM_REQUEST` (`400`): `escrowId` or `clientOpId` is not a UUID.
- `ESCROW_NOT_FOUND` (`404`): the escrow does not exist or the caller is not its guest or host.
- `CLIENT_OP_ID_REUSED` (`409`): the `clientOpId` was already used for a different escrow.
- `ESCROW_NOT_RELEASED` (`409`): the reservation is not `completed`; use dispute instead.
- `CLAIM_RATE_LIMITED` (`429`): five claims in the last 24 hours; see `Retry-After`.
