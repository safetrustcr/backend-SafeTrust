# Agent Property Discovery API

The read-only property discovery API is mounted at `/api/v1/properties` before the general `/api` Firebase-auth boundary.

## Endpoints

| Method | Path | Query parameters |
|---|---|---|
| `GET` | `/api/v1/properties/search` | `check_in`, `check_out`, `guests`, `location`, `min_bedrooms`, `max_price`, `page`, `limit` |
| `GET` | `/api/v1/properties/:id/availability` | `check_in`, `check_out`, `guests` |

Dates use `YYYY-MM-DD` and must be future dates with check-out after check-in. `guests` must be at least one, and search `limit` is capped at 50. Invalid query parameters or property IDs return `400` before authentication or payment is attempted.

## Session and payment

A request with a valid Firebase bearer token is free. A caller with no authorization header receives an x402 `402 Payment Required` challenge for `0.001 USDC`; the request continues only after the current Stellar x402 payment middleware validates the `x-payment` header. An invalid, expired, or malformed bearer token returns `401` and never falls through to payment, even if an `x-payment` header is present.

The anonymous payment path requires `X402_ENABLED=true` and a configured platform wallet; otherwise it returns `503`.

`/api/auth/wallet-challenge` currently verifies and registers a wallet for an already Firebase-authenticated user; it does not issue a wallet-only session. Wallet-only authentication is not supported by this API.

## Availability and quote

Search reuses `safetrust.search_apartments` for location, maximum nightly price, and guest-capacity filtering, then applies `min_bedrooms` as a minimum and checks dates. A property is unavailable if it is not an active listing, a reservation with any status other than `cancelled` overlaps `[check_in, check_out)`, or an unexpired `pending_payment` or `active` booking hold overlaps those dates.

The quote uses integer-cent arithmetic. `nightly_price` comes from the apartment's `price`; `total` is `nightly_price × nights`; `deposit` is the apartment's fixed `warranty_deposit`; and `asset` is `USDC`. All monetary values are decimal strings, never floating-point numbers. Booking/escrow creation (Issue 21) must use the same `calculatePropertyQuote` function so the displayed quote and escrow amount cannot diverge.

Example availability response:

```json
{
  "property_id": "11111111-1111-4111-8111-111111111111",
  "available": true,
  "nights": 5,
  "nightly_price": "30.00",
  "total": "150.00",
  "deposit": "45.00",
  "asset": "USDC"
}
```
