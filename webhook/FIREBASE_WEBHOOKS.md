# Firebase Webhooks Handler

This document describes the Firebase webhook implementation for SafeTrust backend, which handles Firebase authentication events and maintains data consistency between Firebase and the local database.

## Overview

The Firebase webhook handler provides secure endpoints to receive and process Firebase authentication events, automatically syncing user data to maintain consistency across systems.

## Features

- **Secure Webhook Processing**: HMAC signature validation for webhook authenticity
- **Rate Limiting**: Protection against abuse with configurable limits
- **Request Validation**: Size limits and timeout protection
- **Database Sync**: Automatic user data synchronization
- **Error Handling**: Comprehensive error handling and logging
- **Health Monitoring**: Health check endpoints for monitoring

## Endpoints

### POST /webhooks/firebase/user-created
Handles Firebase user creation events.

**Headers:**
- `X-Hub-Signature-256` or `X-Firebase-Signature`: HMAC signature for validation

**Request Body:**
```json
{
  "data": {
    "uid": "firebase-user-id",
    "email": "user@example.com",
    "displayName": "John Doe",
    "phoneNumber": "+1234567890",
    "photoURL": "https://example.com/photo.jpg",
    "metadata": {
      "creationTime": "2024-01-01T00:00:00Z",
      "lastSignInTime": "2024-01-01T00:00:00Z"
    }
  }
}
```

**Response:**
```json
{
  "message": "User created successfully",
  "userId": "firebase-user-id"
}
```

### POST /webhooks/firebase/user-updated
Handles Firebase user update events.

**Headers:**
- `X-Hub-Signature-256` or `X-Firebase-Signature`: HMAC signature for validation

**Request Body:**
```json
{
  "data": {
    "uid": "firebase-user-id",
    "email": "updated@example.com",
    "displayName": "John Smith",
    "phoneNumber": "+1987654321",
    "photoURL": "https://example.com/new-photo.jpg"
  }
}
```

**Response:**
```json
{
  "message": "User updated successfully",
  "userId": "firebase-user-id"
}
```

### POST /webhooks/firebase/user-deleted
Handles Firebase user deletion events.

**Headers:**
- `X-Hub-Signature-256` or `X-Firebase-Signature`: HMAC signature for validation

**Request Body:**
```json
{
  "data": {
    "uid": "firebase-user-id"
  }
}
```

**Response:**
```json
{
  "message": "User deleted successfully",
  "userId": "firebase-user-id"
}
```

### GET /webhooks/firebase/health
Health check endpoint for monitoring.

**Response:**
```json
{
  "status": "ok",
  "service": "firebase-webhooks",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0"
}
```

## Security Features

### Signature Validation
All webhook requests must include a valid HMAC signature in the header:
- `X-Hub-Signature-256` (preferred)
- `X-Firebase-Signature` (fallback)

The signature is calculated using SHA-256 HMAC with the webhook secret.

### Rate Limiting
- **Window**: 60 seconds
- **Limit**: 100 requests per IP per window
- **Response**: 429 Too Many Requests with retry-after header

### Request Validation
- **Size Limit**: 1MB maximum request size
- **Timeout**: 30 seconds request timeout
- **Content-Type**: JSON only

## Configuration

### Environment Variables

```bash
# Database Configuration
DATABASE_URL=postgres://user:password@host:port/database

# Firebase Webhook Configuration
FIREBASE_WEBHOOK_SECRET=your_webhook_secret_here

# Server Configuration
PORT=3000
NODE_ENV=production

# Security Configuration
WEBHOOK_TIMEOUT=30000
MAX_REQUEST_SIZE=1048576
```

### Database Schema

The webhook handler expects a `users` table with the following structure:

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,  -- Firebase UID
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    phone_number TEXT,
    country_code TEXT,
    profile_image_url TEXT,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Error Handling

### HTTP Status Codes

- **200**: Success
- **400**: Bad Request (invalid data)
- **401**: Unauthorized (invalid signature)
- **408**: Request Timeout
- **413**: Payload Too Large
- **429**: Too Many Requests (rate limited)
- **500**: Internal Server Error
- **503**: Service Unavailable (database issues)

### Error Response Format

```json
{
  "error": "Error description",
  "details": "Additional error details",
  "retryAfter": 30
}
```

## Logging

The webhook handler logs the following events:
- Webhook requests received
- Signature validation results
- Database operations (create/update/delete)
- Rate limiting violations
- Errors and exceptions

## Monitoring

### Health Checks
Use the `/webhooks/firebase/health` endpoint for:
- Service availability monitoring
- Load balancer health checks
- Automated monitoring systems

### Metrics to Monitor
- Request rate and volume
- Error rates by type
- Response times
- Database connection health
- Rate limiting triggers

## Firebase Setup

### Webhook Configuration
1. Configure Firebase Authentication webhooks
2. Set the webhook URL to: `https://your-domain.com/webhooks/firebase/user-created`
3. Generate and configure the webhook secret
4. Test the webhook endpoints

### Event Types
The webhook handler supports these Firebase events:
- `providers/firebase.auth/eventTypes/user.create`
- `providers/firebase.auth/eventTypes/user.update`
- `providers/firebase.auth/eventTypes/user.delete`

## Testing

### Manual Testing
```bash
# Test user creation
curl -X POST http://localhost:3000/webhooks/firebase/user-created \
  -H "Content-Type: application/json" \
  -H "X-Firebase-Signature: sha256=your_signature" \
  -d '{"data":{"uid":"test123","email":"test@example.com"}}'

# Test health endpoint
curl http://localhost:3000/webhooks/firebase/health
```

### Signature Generation
```javascript
const crypto = require('crypto');
const secret = 'your_webhook_secret';
const payload = JSON.stringify({data: {uid: 'test123'}});
const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
```

## Troubleshooting

### Common Issues

1. **Invalid Signature**: Verify webhook secret configuration
2. **Database Connection**: Check DATABASE_URL and database availability
3. **Rate Limiting**: Monitor request frequency and adjust limits if needed
4. **Timeout Issues**: Check database performance and network connectivity

### Debug Mode
Set `NODE_ENV=development` for additional logging and relaxed security settings.

## Security Considerations

1. **Webhook Secret**: Use a strong, unique secret for each environment
2. **HTTPS**: Always use HTTPS in production
3. **IP Whitelisting**: Consider restricting webhook access to Firebase IPs
4. **Monitoring**: Monitor for suspicious activity and failed requests
5. **Database Security**: Use connection pooling and proper access controls

## Performance

- **Connection Pooling**: Uses PostgreSQL connection pooling
- **Transaction Management**: Proper transaction handling with rollback on errors
- **Memory Management**: Efficient rate limiting with automatic cleanup
- **Error Recovery**: Graceful error handling with proper HTTP status codes




