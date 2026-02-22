# Escrow Status Endpoint Implementation

## Issue #253 - Retrieve Escrow Status and Details

### Overview
Implemented a REST API endpoint to retrieve comprehensive escrow contract status by combining local database data with Trustless Work API information.

---

## Implementation Details

### Endpoint
```
GET /api/escrow/status/:contractId
```

### Authentication
- **Type**: Firebase JWT Token
- **Header**: `Authorization: Bearer <token>`
- **Required**: Yes

### Features Implemented
✅ Contract ID validation from route parameters  
✅ Firebase JWT authentication middleware  
✅ Trustless Work API integration for external status  
✅ Hasura GraphQL database queries for local metadata  
✅ Combined comprehensive response with all escrow details  
✅ Error handling (400, 401, 404, 500)  
✅ Rate limiting (100 requests per 15 minutes)  
✅ Sync status between local and external systems  

---

## Files Created

### 1. Main Endpoint Handler
**`webhook/routes/escrow-status.js`**
- Handles GET request for escrow status
- Validates contractId parameter
- Queries local database for escrow details, participants, property, milestones
- Calls Trustless Work API for external status
- Combines all data into comprehensive response
- Returns sync status indicating data consistency

### 2. Trustless Work API Service
**`webhook/services/trustless-work.service.js`**
- Service class for Trustless Work API integration
- Methods:
  - `getEscrowStatus(contractId)` - Get escrow status
  - `getTransactionHistory(contractId)` - Get transaction history
  - `getMilestones(contractId)` - Get milestone details
- Handles API errors gracefully
- Configurable via environment variables

### 3. Firebase Authentication Middleware
**`webhook/middleware/firebase-auth.js`**
- Verifies Firebase JWT tokens
- Extracts user context from token claims
- Adds user info to request object
- Handles token expiration and invalid tokens
- Supports optional authentication mode

### 4. Refund Requested Event Handler
**`webhook/events/refund-requested.js`**
- Handles refund requested events
- Notifies all participants
- Logs event processing

### 5. Test Script
**`webhook/test-escrow-status.js`**
- Command-line test utility
- Usage: `node webhook/test-escrow-status.js <contract_id> <firebase_token>`
- Displays formatted response with analysis
- Shows sync status and data availability

---

## Files Modified

### 1. Package Dependencies
**`webhook/package.json`**
- Added `axios: ^1.6.0` for HTTP requests
- Added `firebase-admin: ^12.0.0` for JWT verification

### 2. Main Application
**`webhook/index.js`**
- Imported Firebase authentication middleware
- Imported escrow status routes
- Registered `/api/escrow` route with Firebase JWT protection
- Added rate limiting for escrow endpoints
- Updated startup logs

### 3. Environment Configuration
**`.env_example`**
- Added `TRUSTLESS_WORK_API_URL` configuration
- Added `TRUSTLESS_WORK_API_KEY` configuration

---

## Response Structure

```json
{
  "success": true,
  "data": {
    "local": {
      "id": "uuid",
      "contract_id": "string",
      "status": "PENDING|ACTIVE|RELEASED|REFUNDED",
      "amount": "number",
      "signer_address": "string",
      "created_at": "timestamp",
      "updated_at": "timestamp"
    },
    "external": {
      "status": "string",
      "contract_address": "string",
      "blockchain_status": "string",
      "funded_amount": "number",
      "released_amount": "number"
    },
    "parties": [
      {
        "id": "uuid",
        "email": "string",
        "name": "string",
        "role": "landlord|tenant|participant"
      }
    ],
    "property": {
      "id": "uuid",
      "title": "string",
      "address": "string",
      "monthly_rent": "number"
    },
    "milestones": [
      {
        "id": "uuid",
        "description": "string",
        "amount": "number",
        "status": "pending|approved|released"
      }
    ],
    "transaction_history": [],
    "api_call_history": [],
    "sync_status": {
      "local_available": true,
      "external_available": true,
      "synced": true,
      "last_checked": "timestamp"
    }
  }
}
```

---

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Contract ID is required",
  "code": "VALIDATION_ERROR"
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "message": "JWT token has expired",
  "code": "TOKEN_EXPIRED"
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Escrow contract not found",
  "code": "NOT_FOUND"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Failed to retrieve escrow status",
  "code": "INTERNAL_ERROR"
}
```

---

## Environment Variables Required

```bash
# Firebase Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-client-email
FIREBASE_PRIVATE_KEY=your-private-key

# Trustless Work API
TRUSTLESS_WORK_API_URL=https://api.trustlesswork.com
TRUSTLESS_WORK_API_KEY=your-api-key

# Database
DATABASE_URL=postgresql://user:password@host:port/database
```

---

## Testing

### Install Dependencies
```bash
cd webhook
npm install
```

### Run Test Script
```bash
node webhook/test-escrow-status.js <contract_id> <firebase_token>
```

### Manual cURL Test
```bash
curl -X GET \
  'http://localhost:3001/api/escrow/status/CONTRACT_ID' \
  -H 'Authorization: Bearer YOUR_FIREBASE_TOKEN' \
  -H 'Content-Type: application/json'
```

---

## Security Features

- **JWT Authentication**: All requests require valid Firebase JWT token
- **Rate Limiting**: 100 requests per 15 minutes per user
- **Input Validation**: Contract ID validated before processing
- **Error Sanitization**: Detailed errors only shown in development mode
- **Audit Logging**: All requests logged for security monitoring

---

## Data Sources

### Local Database (PostgreSQL/Hasura)
- Escrow transaction details
- Participant information
- Property/apartment details
- Milestone tracking
- API call history

### Trustless Work API
- External escrow status
- Blockchain transaction status
- Smart contract details
- Transaction history

---

## Acceptance Criteria Met

✅ Route: GET /api/escrow/status/:contractId  
✅ Validate contractId from route parameter  
✅ Query Trustless Work API for escrow status  
✅ Query Hasura GraphQL DB for local metadata  
✅ Combine and return comprehensive escrow information  
✅ Handle errors (validation 400, internal 500)  
✅ JWT authentication required  
✅ Database and external API data are synced  

---

## Next Steps

1. Configure Trustless Work API credentials in `.env`
2. Test endpoint with valid contract IDs
3. Monitor sync status for data consistency
4. Add caching layer if needed for performance
5. Implement webhook for real-time status updates
