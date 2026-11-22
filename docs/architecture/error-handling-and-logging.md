# Error Handling, Logging and CORS

How the webhook service classifies errors, what a client may see in an error
response, how logs are correlated with requests, and which browser origins may
call the API.

## Request pipeline

```mermaid
graph LR
  A[request] --> B["requestId<br/>X-Request-Id, access log"]
  B --> C[helmet]
  C --> D["cors<br/>explicit origin policy"]
  D --> E["express.json<br/>raw body kept on req.rawBody"]
  E --> F["bindRequestContext<br/>request id for the logger"]
  F --> G[routes]
  G --> H[notFoundHandler]
  E -. parse error .-> I
  G -. thrown error .-> I["errorHandler<br/>typed mapping, sanitized body"]
```

| File | Responsibility |
|---|---|
| `webhook/src/utils/errors.ts` | `AppError` hierarchy and `classifyError` |
| `webhook/src/middleware/error-handler.ts` | Global error handler and JSON 404 |
| `webhook/src/middleware/logger.ts` | Structured logger, request id and access log |
| `webhook/src/utils/response.ts` | Canonical response helpers, including `sendError` |
| `webhook/src/config/cors.ts` | CORS origin policy |

## Typed errors

Services and middleware throw `AppError` subclasses. The global error handler,
and `sendError` inside a handler, map them to a status:

| Class | Status | Code | Message to client |
|---|---|---|---|
| `ValidationError` | 400 | `validation_error` | its message |
| `AuthError` | 401 | `unauthorized` | its message |
| `ForbiddenError` | 403 | `forbidden` | its message |
| `NotFoundError` | 404 | `not_found` | its message |
| `ConflictError` | 409 | `conflict` | its message |
| `ServiceUnavailableError` | 503 | `service_unavailable` | `Service unavailable` |
| any other error | 500 | `internal_error` | `Internal server error` |

The existing domain errors are part of the hierarchy and keep their names, so
`instanceof` checks are unchanged: `EscrowNotFoundError`,
`ReservationNotFoundError` and `MilestoneNotFoundError` are `NotFoundError`s;
`StateConflictError`, `StaleStateError` and `EscrowStateConflictError` are
`ConflictError`s; and `TenantMismatchError` is a `ForbiddenError`.
`EscrowValidationError` and `MilestoneValidationError` keep their configurable
status. Each sets a specific code such as `escrow_not_found` or
`tenant_mismatch`.

Errors that body-parser raises before any route runs are classified too:
malformed JSON is `400 invalid_json`, an oversized body `413
payload_too_large`, and an unsupported encoding or charset `415`.

## What a client may see

Every error body has the shape `{ success: false, error, code?, requestId? }`.

- **4xx** bodies carry the error's message, which is written for the client.
- **5xx** bodies never carry `err.details`, `err.message`, a stack, or a
  database, Hasura or provider name. They carry a fixed message, the code, and
  the `requestId`. This holds even if a 5xx `AppError` is created with
  `expose: true`.
- The full error, including `details` and the stack, goes to the log under the
  same `requestId`. Quote the id from the response or the `X-Request-Id`
  header to find it.

`serverError()` and `serviceUnavailable()` enforce the 5xx rule: they keep only
the message string and code they are given, whatever else is passed.

### Moving handlers to the canonical helpers

`utils/response.ts` is the single response helper. Handlers move to it
incrementally, because the frontend may depend on the shapes they return
today. The escrow lifecycle and reconciliation handlers already use it. The
others (auth, wallets, apartments, bid requests, escrow claims, reservations,
and some middleware) still write their own shapes. Their 5xx bodies are
fixed strings with no internal detail. When you touch one of them, replace
`res.status(...).json(...)` with the matching helper, or throw an `AppError` and
let `sendError` or the global handler respond.

## Structured logs

`logger` writes one JSON object per line:

```json
{"time":"2026-11-15T03:12:44.120Z","level":"error","event":"escrow.fund.failed","requestId":"6f1c…","contractId":"CAAT…","error":{"name":"Error","message":"…","stack":"…"}}
```

- `event` is a stable dotted name (`<area>.<action>.<outcome>`), so you can
  search and alert on it. Variable data goes in fields, never in the event.
- `requestId` is added automatically inside a request. `bindRequestContext`
  stores it in `AsyncLocalStorage`, so services log with it too, without
  passing it down. It is mounted after the body parser because the parser
  resumes on stream events, which would lose the async context.
- Every response writes one `http.request` line with method, path (without the
  query string), status and `durationMs`. It is `warn` for 4xx and `error` for
  5xx.
- An incoming `X-Request-Id` is reused when it is 8–128 characters of
  `[A-Za-z0-9._:-]`, so ids from a proxy or the frontend carry through;
  otherwise a UUID is generated.
- `LOG_LEVEL` is `debug`, `info` (default), `warn`, `error` or `silent`.

Application code under `webhook/src` must not call `console.*` directly;
`middleware/logger.ts` is the only exception because it writes the structured
JSON lines to stdout/stderr. `routes/__tests__/structured-logging-boundary.test.ts`
enforces this across every source directory. Use a stable dotted event and
structured fields; request-scoped calls automatically include `requestId`.

## Request validation

Routes with a body or query string validate it with a Zod schema in
`webhook/src/validation/`, applied through `validate(schema)` before the
handler. Handler payload types are inferred from those schemas. Invalid input
returns HTTP 400 with this format:

```json
{
  "error": "validation_failed",
  "fields": {
    "name": "Required"
  }
}
```

`fields` maps each invalid field path to its first validation message. This
format is shared across routes and replaces route-specific 400 response shapes
for schema validation failures; frontend clients should check
`error === "validation_failed"` and display `fields`. Domain-level errors that
occur after schema validation keep their existing response formats.

Authenticated user requests take their tenant from the verified session at
`req.context.tenantId`; request bodies and headers cannot select another
tenant. Reconciliation and other jobs without a user session pass
`getPlatformTenantId()` explicitly through the service and repository calls.

## Raw body for signed webhooks

TrustlessWork callbacks are verified with an HMAC over
`timestamp + '.' + rawBody`. `express.json({ verify })` stores the exact
request bytes on `req.rawBody` before parsing, and the error-handling change
leaves that path as it was. `src/__tests__/app.errors.test.ts` checks it end to
end: a signature over the bytes sent is accepted, and a signature over the
re-serialized JSON is rejected.

## CORS origin policy

CORS only affects browsers. TrustlessWork, the Hasura cron trigger and x402
agents send no `Origin` header and are unaffected; signatures and secrets
protect those routes.

| `CORS_ALLOWED_ORIGINS` | `NODE_ENV` | Allowed browser origins |
|---|---|---|
| comma-separated origins | any | exactly those origins |
| `*` | any | any origin (explicit opt-in, never the default) |
| unset | `production` | none (fails closed, warning logged at startup) |
| unset | anything else | `http(s)://localhost` and `127.0.0.1`, any port |

**Production must set `CORS_ALLOWED_ORIGINS` to the frontend's origin(s)**,
for example `https://app.safetrust.example`, plus any staging origin that calls
the production API. Each entry must be an exact `scheme://host[:port]` with no
path, and an invalid entry fails startup. The browser can read the
`X-Request-Id` response header (`exposedHeaders`). An origin that is not
allowed gets no CORS headers, so the browser blocks the response, and the
server still processes the request normally.
