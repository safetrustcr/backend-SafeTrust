# Webhook API security

## Route access

`/api` requires a Firebase ID token, verifies that it has not been revoked, and
loads the caller's roles from `user_roles`. Write routes enforce the roles
below; ownership checks remain in the relevant service or handler.

| Route | Allowed roles |
| --- | --- |
| `POST /api/apartments` | `host`, `admin` |
| `PATCH /api/bid-requests/:id` | `host`, `admin` |
| `POST /api/bid-requests` | `guest`, `host` |
| `POST /api/reservations` | `guest`, `host` |
| `POST /api/reservations/:id/cancel` | `guest`, `host` |
| `POST /api/escrow-claims/:escrowId` | `guest`, `host` |
| `POST /api/apartments/:id/reports` | `guest`, `host` |
| `POST /api/auth/sync-user`, `POST /api/auth/sync-wallet` | `guest`, `host`, `admin` |
| `POST /api/auth/wallet/challenge`, `POST /api/auth/wallet/verify` | `guest`, `host`, `admin` |
| `DELETE /api/auth/wallets/:address`, `POST /api/auth/wallets/:address/primary` | `guest`, `host`, `admin` |
| `POST /api/escrows/confirm-transaction` | `guest`, `host`, `admin` |
| `POST /api/v1/bookings/hold`, `DELETE /api/v1/bookings/hold/:id` | `guest` |

Reads under `/api` require authentication. Resource ownership is separately
checked for bid status changes, reservations, wallet operations, and user-owned
records.

`GET /health/live`, `GET /health/ready`, `POST /api/escrows/initialize`, and
`POST /reconciliation/sync-escrows` are the public route exceptions. Escrow
initialization requires x402 payment; reconciliation uses its Hasura event
secret when configured and must have `HASURA_EVENT_SECRET` set in production.

## Hasura permission differences

- Apartment creation and bid status changes use roles consistent with Hasura's
  host/admin insert and host/admin update permissions.
- Bid creation permits guest and host in the API, while Hasura's direct table
  insert permission is guest/admin. The API does not expose a direct Hasura
  insert path; it enforces role and ownership through its service.
- Reservation creation and cancellation permit guest/host through the API's
  business logic. Hasura does not grant guest/host direct insert/update access
  to reservations; these actions remain API-only.
- Escrow claims and listing reports are API service actions and do not have
  corresponding table permissions in the documented Hasura metadata.

## Rate limits and proxy configuration

Limits are per process and use in-memory storage. Authenticated API requests
are keyed by user ID; anonymous or invalid-token API traffic is additionally
bounded by source IP before Firebase verification. Auth endpoints also have
their stricter limit applied by IP before Firebase verification and by user ID
after it succeeds. Public routes use the source IP. A 429 response includes
`Retry-After`.

| Environment variable | Default | Scope |
| --- | ---: | --- |
| `API_RATE_LIMIT_WINDOW_MS` | `900000` | API user and IP limit window |
| `API_RATE_LIMIT_MAX` | `100` | Requests per user per API window |
| `API_IP_RATE_LIMIT_MAX` | `300` | Requests per IP at the API boundary |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` | Auth endpoint window |
| `AUTH_RATE_LIMIT_MAX` | `10` | Requests per IP before auth and per user after auth |
| `PUBLIC_RATE_LIMIT_WINDOW_MS` | `900000` | Public business-route window |
| `PUBLIC_RATE_LIMIT_MAX` | `60` | Requests per IP per public window |
| `HEALTH_RATE_LIMIT_WINDOW_MS` | `900000` | Health endpoint window |
| `HEALTH_RATE_LIMIT_MAX` | `600` | Requests per IP per health window |

Set `TRUST_PROXY` only when the service is behind a trusted reverse proxy. It
accepts a hop count (for example `1`), `true`/`false`, or a comma-separated
list of trusted proxy addresses. Leave it unset when directly exposed.
Deployments with multiple webhook instances must configure a shared rate-limit
store; the default in-memory store is instance-local.

JSON request bodies are limited to 100 KB. Raw body retention is not used.
