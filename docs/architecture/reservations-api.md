# 🏨 Reservations & Allowed Actions API

Frontend documentation for listing, viewing, and safely cancelling apartment reservations on SafeTrust.

---

## 🎯 Overview

The Reservations API provides endpoints to:
1. **List reservations** for the authenticated user (as guest, host, or both) with server-computed `allowedActions`.
2. **Retrieve a single reservation** with status, contract details, and permissions.
3. **Safely cancel a reservation** before escrow funding with idempotent semantics.

### Key Lifecycle Rules

- **Allowed cancellation stages**: Reservations can only be cancelled while in `pending` or `escrow_created` status.
- **Funded escrows**: Once a reservation reaches `funded` or beyond, funds are locked in the Trustless Work smart contract. These cannot be cancelled via this endpoint and must follow the refund or dispute resolution protocol (`process_refund_request`, `open_dispute`).
- **No manual completion**: Completion is never triggered by a manual status button. Status reaches `completed` only when funds are released to the host upon approved milestone completion via on-chain Trustless Work webhooks.
- **`escrow_created` contract behavior**: If a reservation in `escrow_created` status is cancelled, the on-chain escrow contract on Stellar was initialized but never funded. No funds were locked. The contract remains permanently unfunded and inactive, and is no longer linked to an active booking. The PostgreSQL exclusion constraint unblocks the apartment calendar dates for new reservations.

---

## 📋 Types & Data Transfer Objects (DTO)

### ReservationDto

```typescript
export type ReservationStatus =
  | 'pending'
  | 'escrow_created'
  | 'funded'
  | 'checked_in'
  | 'checked_out'
  | 'completed'
  | 'disputed'
  | 'resolved'
  | 'cancelled'

export type ReservationAction = 'view' | 'view_contract' | 'cancel'

export type Party = 'guest' | 'host' | 'admin'

export interface ReservationDto {
  id: string
  status: ReservationStatus
  checkIn: string           // ISO 8601 date string
  checkOut: string          // ISO 8601 date string
  amount: string            // Decimal formatted as string (never a float)
  asset: string             // e.g. 'USDC'
  apartment: {
    id: string
    name: string
  }
  contractId: string | null // Stellar contract ID (if escrow initialized)
  party: 'guest' | 'host'   // Role of the authenticated caller
  allowedActions: ReservationAction[]
}
```

### Action Matrix

| Status | Party | `hasContract = false` | `hasContract = true` | Notes |
|---|---|---|---|---|
| `pending` | guest, host, admin | `['view', 'cancel']` | `['view', 'view_contract', 'cancel']` | Booking placed, not yet deployed |
| `escrow_created` | guest, host, admin | `['view', 'cancel']` | `['view', 'view_contract', 'cancel']` | Contract deployed, waiting for deposit |
| `funded` | guest, host, admin | `['view']` | `['view', 'view_contract']` | Deposit locked on-chain |
| `checked_in` | guest, host, admin | `['view']` | `['view', 'view_contract']` | Check-in milestone approved |
| `checked_out` | guest, host, admin | `['view']` | `['view', 'view_contract']` | Check-out milestone approved |
| `completed` | guest, host, admin | `['view']` | `['view', 'view_contract']` | Funds released to host |
| `disputed` | guest, host, admin | `['view']` | `['view', 'view_contract']` | Dispute initiated |
| `resolved` | guest, host, admin | `['view']` | `['view', 'view_contract']` | Dispute resolved |
| `cancelled` | guest, host, admin | `['view']` | `['view', 'view_contract']` | Cancelled prior to funding |

---

## 📡 Endpoints

### 1. List Reservations

**`GET /api/reservations`**

Query parameters:
- `role` (optional): `'guest' | 'host'`. If omitted or `'both'`, returns all reservations where caller is guest or apartment owner.
- `limit` (optional): integer (default `50`, max `100`).
- `offset` (optional): integer (default `0`).
- `page` (optional): integer (alternative to offset, 1-indexed).

**Headers:**
```http
Authorization: Bearer <firebase_jwt_token>
```

**Response (200 OK):**
```json
{
  "reservations": [
    {
      "id": "e0b82143-a64d-45db-9c3f-42e5d7ad8109",
      "status": "pending",
      "checkIn": "2026-11-01T00:00:00.000Z",
      "checkOut": "2026-11-05T00:00:00.000Z",
      "amount": "450.00",
      "asset": "USDC",
      "apartment": {
        "id": "a1f11c75-22d7-40fa-ba41-948ff1dbba62",
        "name": "Luxury Oceanfront Condo"
      },
      "contractId": null,
      "party": "guest",
      "allowedActions": [
        "view",
        "cancel"
      ]
    }
  ]
}
```

---

### 2. Get Reservation By ID

**`GET /api/reservations/:id`**

**Headers:**
```http
Authorization: Bearer <firebase_jwt_token>
```

**Responses:**
- **`200 OK`**: Returns the `ReservationDto` for the requested ID.
- **`404 Not Found`**: Returned if the reservation does not exist OR the caller is neither the guest nor the apartment owner (prevents information leakage).
- **`401 Unauthorized`**: Caller is missing valid authentication.

---

### 3. Cancel Reservation

**`POST /api/reservations/:id/cancel`**

Allows the guest or apartment owner to cancel a reservation before it has been funded on-chain.

**Headers:**
```http
Authorization: Bearer <firebase_jwt_token>
Content-Type: application/json
```

**Request Body (optional):**
```json
{
  "reason": "Family emergency; unable to travel."
}
```
*Note: `reason` must be a string of at most 500 characters.*

**Responses:**

| Case | Status | Response Body |
|---|---|---|
| Successfully cancelled | `200 OK` | Updated `ReservationDto` with `status: 'cancelled'` and `allowedActions: ['view', ...]` |
| Already cancelled (idempotent retry) | `200 OK` | Existing `ReservationDto` |
| Caller is not guest/owner, or ID missing | `404 Not Found` | `{"error": "Reservation not found"}` |
| Reservation is funded or later stage | `409 Conflict` | `{"error": "RESERVATION_NOT_CANCELLABLE", "status": "<current_status>"}` |
| Invalid reason payload | `400 Bad Request` | `{"error": "Cancellation reason must be 500 characters or less"}` |
| Unauthenticated | `401 Unauthorized` | `{"error": "Unauthorized"}` |
