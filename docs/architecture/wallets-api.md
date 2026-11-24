# Wallet Registry API Architecture

This document describes the API endpoints, state transitions, security guarantees, and error specifications for managing user Stellar wallets in SafeTrust.

---

## 1. Overview

Users authenticate with SafeTrust via email, Google, or direct Stellar wallet signature. Verified wallets associated with a user are persisted in `safetrust.user_wallets`.

The wallet registry API allows authenticated users to:
1. Issue a cryptographic challenge (`POST /api/auth/wallet/challenge`).
2. Verify Ed25519 signature to prove ownership and register the wallet (`POST /api/auth/wallet/verify`).
3. List all verified wallets belonging to their account (`GET /api/auth/wallets`).
4. Unlink a wallet from their account (`DELETE /api/auth/wallets/:address`).
5. Designate a wallet as primary (`POST /api/auth/wallets/:address/primary`).

---

## 2. Endpoints

### 2.1 Issue Challenge
- **Endpoint**: `POST /api/auth/wallet/challenge`
- **Auth**: Required (`authMiddleware` via `/api` boundary)
- **Request Body**:
  ```json
  {
    "wallet_address": "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57"
  }
  ```
- **Success (200 OK)**:
  ```json
  {
    "challengeId": "uuid-v4",
    "challenge": "{\"purpose\":\"SafeTrust wallet ownership verification\",...}",
    "expiresAt": "2026-10-22T12:00:00.000Z"
  }
  ```
- **Error Codes**:
  - `400 INVALID_STELLAR_ACCOUNT`: Malformed Stellar public key.
  - `400 UNSUPPORTED_STELLAR_ACCOUNT_TYPE`: Multi-signer or contract accounts are rejected.
  - `503 WALLET_CHALLENGE_NOT_CONFIGURED` / `WALLET_SIGNATURE_VERIFIER_UNAVAILABLE`

---

### 2.2 Verify Challenge and Link Wallet
- **Endpoint**: `POST /api/auth/wallet/verify`
- **Auth**: Required
- **Request Body**:
  ```json
  {
    "challengeId": "uuid-v4",
    "signature": "<128-hex Ed25519 signature>",
    "is_primary": false
  }
  ```
- **Success (200 OK)**:
  ```json
  {
    "success": true,
    "wallet_address": "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57"
  }
  ```
- **Error Codes**:
  - `400 INVALID_WALLET_CHALLENGE_REQUEST`
  - `401 INVALID_WALLET_SIGNATURE` / `WALLET_CHALLENGE_EXPIRED` / `WALLET_CHALLENGE_USER_MISMATCH`
  - `409 WALLET_ALREADY_REGISTERED` / `WALLET_CHALLENGE_ALREADY_USED_OR_UNKNOWN`

---

### 2.3 List Wallets
- **Endpoint**: `GET /api/auth/wallets`
- **Auth**: Required
- **Success (200 OK)**:
  ```json
  {
    "wallets": [
      {
        "address": "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
        "chain": "STELLAR",
        "isPrimary": true,
        "createdAt": "2026-10-20T10:00:00.000Z"
      }
    ],
    "signInWallet": "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57"
  }
  ```
- **Ordering**: Primary wallet first (`is_primary DESC`), then creation order (`created_at ASC`).
- **Sign-in Wallet Detection**:
  For wallet-authenticated accounts, the Firebase UID is `stellar_<sha256(address)>`. The endpoint matches the caller's UID hash against the wallets and returns the matching address as `signInWallet`, or `null` for email/Google sign-in.

---

### 2.4 Unlink Wallet
- **Endpoint**: `DELETE /api/auth/wallets/:address`
- **Auth**: Required
- **Success (204 No Content)**
- **Rules & Behavior**:
  1. **Address Validation**: Must match `/^[GC][A-Z2-7]{55}$/`; returns `400 INVALID_WALLET_ADDRESS` if invalid.
  2. **Sign-In Method Guard**: If the target address is the user's sign-in wallet (`stellar_<sha256(address)> === uid`), unlinking is rejected with `409 WALLET_IS_SIGN_IN_METHOD` to prevent account lockout.
  3. **Isolation & Ownership**: Deletes only where `user_id = $1 AND wallet_address = $2`. If no row was deleted, returns `404 WALLET_NOT_FOUND`.
  4. **Primary Promotion**: When the unlinked wallet was marked `is_primary`, the oldest remaining wallet is atomically promoted to primary within the same database transaction:
     ```sql
     UPDATE safetrust.user_wallets SET is_primary = true, updated_at = NOW()
     WHERE id = (SELECT id FROM safetrust.user_wallets WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1);
     ```

---

### 2.5 Set Primary Wallet
- **Endpoint**: `POST /api/auth/wallets/:address/primary`
- **Auth**: Required
- **Success (200 OK)**: Returns updated `ListWalletsResponse`.
- **Rules & Behavior**:
  1. Validates address format (`400 INVALID_WALLET_ADDRESS`).
  2. Queries row `FOR UPDATE` scoped to `user_id = $1 AND wallet_address = $2`. If not found, returns `404 WALLET_NOT_FOUND`.
  3. If already primary, the operation is idempotent and returns `200` with the current state.
  4. If not primary, demotes any existing primary (`UPDATE ... SET is_primary = false WHERE user_id = $1 AND is_primary = true`) and promotes the targeted wallet (`UPDATE ... SET is_primary = true WHERE user_id = $1 AND wallet_address = $2`) within an atomic transaction.
  5. Enforced at the database level by unique partial index `safetrust.user_wallets_one_primary`.

---

## 3. Database Constraints

```sql
CREATE UNIQUE INDEX IF NOT EXISTS user_wallets_one_primary
  ON safetrust.user_wallets(user_id)
  WHERE is_primary;
```
