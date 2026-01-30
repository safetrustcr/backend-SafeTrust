# Hasura Permissions Testing & Deployment Guide for SafeTrust Tenant

## 📋 Overview

This guide provides comprehensive instructions for testing and deploying the Hasura row-level security (RLS) and role-based access control (RBAC) permissions for the SafeTrust tenant.

**Status**: All 6 core tables have been configured with comprehensive permissions including:
- ✅ Multi-tenant data isolation using `X-Hasura-Tenant-Id`
- ✅ Row-level security with `X-Hasura-User-Id`
- ✅ Role-based access control (user, admin, anonymous)
- ✅ Automatic column filtering based on session variables
- ✅ Secure GraphQL API operations

## 🔐 Security Architecture

### Tables with Comprehensive Permissions

**Priority 1 (Core Escrow)**:
- `escrow_transactions` - Main escrow data
- `escrow_transaction_users` - Participant tracking (if available)
- `escrow_conditions` - Condition management (if available)

**Priority 2 (Supporting)**:
- `users` - User profiles with RLS
- `user_wallets` - Wallet management with RLS
- `bid_requests` - Bid management with tenant isolation

**Priority 3 (Audit/History)**:
- `escrow_milestones` - Milestone tracking with tenant isolation
- `trustless_work_escrows` - Trustless escrow data with tenant isolation
- `escrow_api_calls` - API call logging with sensitive data protection
- `bid_status_histories` - Bid status audit trail
- `apartments` - Apartment listings with RLS

### Session Variables Required

All requests must include these headers:

```
X-Hasura-Role: "user" | "admin" | "anonymous"
X-Hasura-User-Id: "<uuid>" (user's unique identifier)
X-Hasura-Tenant-Id: "safetrust" (tenant identifier)
```

## 🧪 Testing Permissions Locally

### Prerequisites

1. Hasura GraphQL Engine running locally or in docker
2. PostgreSQL database with SafeTrust tables
3. Postman, cURL, or GraphQL client (Apollo, etc.)
4. Test user accounts with various roles

### Setup Test Environment

```bash
# Navigate to backend directory
cd /Users/pro2018/code/backend-SafeTrust

# Start services with docker-compose
docker-compose up -d

# Verify Hasura is running
curl http://localhost:8080/v1/version
```

### 1. Test Anonymous Role Permissions

**Expected**: Anonymous users should have NO access to sensitive data.

#### Test: Query Escrow Transactions as Anonymous

```bash
curl -X POST http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Role: anonymous" \
  -d '{
    "query": "query { escrow_transactions { id } }"
  }' | jq .
```

**Expected Response**: Empty array or permission denied error
```json
{
  "data": {
    "escrow_transactions": []
  }
}
```

#### Test: Attempt to Insert as Anonymous

```bash
curl -X POST http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Role: anonymous" \
  -d '{
    "query": "mutation { insert_escrow_transactions_one(object: { bid_request_id: \"test\" }) { id } }"
  }' | jq .
```

**Expected Response**: Permission denied error
```json
{
  "errors": [
    {
      "message": "permission denied",
      "extensions": {
        "code": "PERMISSION_DENIED"
      }
    }
  ]
}
```

---

### 2. Test User Role Permissions (Row-Level Security)

**Expected**: Users can only see data where they are participants.

#### Setup Test Users

```sql
-- Execute in PostgreSQL
INSERT INTO users (id, email) VALUES 
  ('user-1', 'alice@example.com'),
  ('user-2', 'bob@example.com'),
  ('user-3', 'charlie@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO apartments (id, owner_id, name, price, is_available) VALUES
  ('apt-1', 'user-1', 'Downtown Loft', 1500, true),
  ('apt-2', 'user-2', 'Suburban Home', 2000, true)
ON CONFLICT DO NOTHING;

INSERT INTO bid_requests (id, apartment_id, tenant_id, current_status, proposed_price, desired_move_in) VALUES
  ('bid-1', 'apt-1', 'user-2', 'PENDING', 1400, now() + interval '30 days'),
  ('bid-2', 'apt-2', 'user-3', 'PENDING', 1900, now() + interval '30 days')
ON CONFLICT DO NOTHING;
```

#### Test: User Sees Only Their Bids

```bash
# User-2's perspective (made bid on apt-1)
curl -X POST http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Role: user" \
  -H "X-Hasura-User-Id: user-2" \
  -H "X-Hasura-Tenant-Id: safetrust" \
  -d '{
    "query": "query { bid_requests { id tenant_id proposed_price } }"
  }' | jq .
```

**Expected Response**: Should see `bid-1` (their bid) and any bids on their apartments
```json
{
  "data": {
    "bid_requests": [
      {
        "id": "bid-1",
        "tenant_id": "user-2",
        "proposed_price": 1400
      }
    ]
  }
}
```

#### Test: User Cannot See Other Users' Private Bids

```bash
# User-3's perspective - should NOT see user-2's bid
curl -X POST http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Role: user" \
  -H "X-Hasura-User-Id: user-3" \
  -H "X-Hasura-Tenant-Id: safetrust" \
  -d '{
    "query": "query { bid_requests(where: { id: { _eq: \"bid-1\" } }) { id } }"
  }' | jq .
```

**Expected Response**: Empty array (access denied)
```json
{
  "data": {
    "bid_requests": []
  }
}
```

#### Test: User Can Only Update Their Own Wallets

```bash
# First, insert a wallet for user-2
curl -X POST http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Role: user" \
  -H "X-Hasura-User-Id: user-2" \
  -H "X-Hasura-Tenant-Id: safetrust" \
  -d '{
    "query": "mutation { insert_user_wallets_one(object: { user_id: \"user-2\", wallet_address: \"0x123...\", chain_type: \"stellar\" }) { id user_id } }"
  }' | jq .
```

**Expected**: Successfully created with user_id automatically set to user-2

#### Test: User Cannot Update Another User's Wallet

```bash
# Try to update user-1's wallet as user-2
curl -X POST http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Role: user" \
  -H "X-Hasura-User-Id: user-2" \
  -H "X-Hasura-Tenant-Id: safetrust" \
  -d '{
    "query": "mutation { update_user_wallets_by_pk(pk_columns: { id: \"wallet-1\" }, _set: { is_primary: true }) { id } }"
  }' | jq .
```

**Expected Response**: Either empty result or permission denied (depending on configuration)

---

### 3. Test Admin Role Permissions

**Expected**: Admins can see ALL data within their tenant but cannot access other tenants.

#### Test: Admin Sees All Escrow Transactions

```bash
curl -X POST http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Role: admin" \
  -H "X-Hasura-User-Id: admin-user-1" \
  -H "X-Hasura-Tenant-Id: safetrust" \
  -d '{
    "query": "query { escrow_transactions { id bid_request_id status } }"
  }' | jq .
```

**Expected**: Admin can see all escrows in their tenant regardless of participation

#### Test: Admin Can Verify Milestones

```bash
curl -X POST http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Role: admin" \
  -H "X-Hasura-User-Id: admin-user-1" \
  -H "X-Hasura-Tenant-Id: safetrust" \
  -d '{
    "query": "mutation { update_escrow_milestones_by_pk(pk_columns: { id: \"milestone-1\" }, _set: { status: \"verified\" }) { id status verified_by verified_at } }"
  }' | jq .
```

**Expected**: Successfully updated with verified_by and verified_at set

---

### 4. Test Tenant Isolation

**Expected**: Users and admins can ONLY access their own tenant's data.

#### Test: Cross-Tenant Access Denied

```bash
# Try to access safetrust data as a different tenant
curl -X POST http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Role: user" \
  -H "X-Hasura-User-Id: user-2" \
  -H "X-Hasura-Tenant-Id: hotel_industry" \
  -d '{
    "query": "query { escrow_transactions { id } }"
  }' | jq .
```

**Expected Response**: Empty array (no data visible from other tenant)
```json
{
  "data": {
    "escrow_transactions": []
  }
}
```

---

### 5. Test Column-Level Security

**Expected**: Users see only specific columns, sensitive data hidden from non-admins.

#### Test: User Cannot See Request/Response Bodies

```bash
# User attempts to query API call logs
curl -X POST http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Role: user" \
  -H "X-Hasura-User-Id: user-2" \
  -H "X-Hasura-Tenant-Id: safetrust" \
  -d '{
    "query": "query { escrow_api_calls { id request_body response_body } }"
  }' | jq .
```

**Expected Response**: Permission denied or columns not available

#### Test: Admin CAN See Request/Response Bodies

```bash
curl -X POST http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Role: admin" \
  -H "X-Hasura-User-Id: admin-user-1" \
  -H "X-Hasura-Tenant-Id: safetrust" \
  -d '{
    "query": "query { escrow_api_calls { id request_body response_body error_details } }"
  }' | jq .
```

**Expected**: Admin can see all sensitive columns

---

## 🚀 Deployment Guide

### Prerequisites for Production

1. ✅ All permissions configured in metadata
2. ✅ Session variables properly set in your authentication layer
3. ✅ Admin secret configured in Hasura environment
4. ✅ Database backups created
5. ✅ All permissions tested in staging environment

### Step 1: Validate Metadata Locally

```bash
cd /Users/pro2018/code/backend-SafeTrust/metadata

# Check for YAML syntax errors
find tenants/safetrust -name "*.yaml" -exec yamllint {} \;

# Or manually validate key files
python3 -c "import yaml; yaml.safe_load(open('tenants/safetrust/databases/tables/public_escrow_transactions.yaml'))" && echo "✓ Valid"
```

### Step 2: Build Metadata

```bash
# Navigate to metadata directory
cd /Users/pro2018/code/backend-SafeTrust/metadata

# Run the build script (if available)
# If build-metadata.sh exists, use it:
# ./build-metadata.sh safetrust --admin-secret YOUR_ADMIN_SECRET --endpoint http://localhost:8080

# Otherwise, manually apply metadata:
hasura metadata apply --admin-secret YOUR_ADMIN_SECRET --endpoint http://localhost:8080
```

### Step 3: Verify Permissions in Hasura Console

1. Open Hasura Console: `http://localhost:8080/console`
2. Go to **Data** tab
3. Select each table and verify permissions are configured:
   - ✓ escrow_transactions
   - ✓ users
   - ✓ user_wallets
   - ✓ bid_requests
   - ✓ apartments
   - ✓ escrow_milestones
   - ✓ trustless_work_escrows
   - ✓ escrow_api_calls
   - ✓ bid_status_histories

### Step 4: Run Full Permission Test Suite

```bash
# Execute comprehensive permission tests
cd /Users/pro2018/code/backend-SafeTrust

# Run tests for each role
bash tests/run_permission_tests.sh \
  --endpoint http://localhost:8080 \
  --admin-secret YOUR_ADMIN_SECRET \
  --tenant safetrust
```

### Step 5: Deploy to Staging

```bash
# Deploy using Hasura CLI
hasura deploy \
  --admin-secret YOUR_STAGING_ADMIN_SECRET \
  --endpoint https://staging-hasura.yourdomain.com

# Verify deployment
curl https://staging-hasura.yourdomain.com/v1/version \
  -H "X-Hasura-Admin-Secret: YOUR_STAGING_ADMIN_SECRET"
```

### Step 6: Smoke Tests in Staging

```bash
# Test with real staging credentials
curl -X POST https://staging-hasura.yourdomain.com/v1/graphql \
  -H "Content-Type: application/json" \
  -H "X-Hasura-Role: user" \
  -H "X-Hasura-User-Id: test-user-id" \
  -H "X-Hasura-Tenant-Id: safetrust" \
  -d '{"query": "query { escrow_transactions { id } }"}'
```

### Step 7: Deploy to Production

```bash
# Deploy to production
hasura deploy \
  --admin-secret YOUR_PRODUCTION_ADMIN_SECRET \
  --endpoint https://prod-hasura.yourdomain.com

# Verify production deployment
curl https://prod-hasura.yourdomain.com/v1/version \
  -H "X-Hasura-Admin-Secret: YOUR_PRODUCTION_ADMIN_SECRET"

# Run final verification tests
bash tests/run_permission_tests.sh \
  --endpoint https://prod-hasura.yourdomain.com \
  --admin-secret YOUR_PRODUCTION_ADMIN_SECRET \
  --tenant safetrust
```

---

## 📊 Permission Summary by Table

| Table | User Read | User Write | Admin Full | Tenant Isolated |
|-------|-----------|-----------|-----------|-----------------|
| escrow_transactions | Own only | Own only | All | ✓ |
| escrow_transaction_users | Own only | Own status | All | ✓ |
| escrow_conditions | Own escrows | Limited | All + verify | ✓ |
| users | Self only | Self only | All users | ✓ |
| user_wallets | Own only | Own only | All | ✓ |
| bid_requests | Own + visible | Own + visible | All | ✓ |
| escrow_milestones | Own escrows | Own escrows | All + approve | ✓ |
| trustless_work_escrows | Guest only | Guest only | All | ✓ |
| escrow_api_calls | Non-sensitive | Admin only | All (sensitive) | ✓ |
| bid_status_histories | Own only | Admin only | All | ✓ |
| apartments | Own + public | Own only | All | ✓ |

---

## 🐛 Troubleshooting

### Issue: "Permission Denied" on Valid Query

**Cause**: Session variables not properly set
**Solution**:
```bash
# Verify headers include:
# X-Hasura-Role: user|admin|anonymous
# X-Hasura-User-Id: <uuid>
# X-Hasura-Tenant-Id: safetrust
```

### Issue: Users Seeing Other Users' Data

**Cause**: Filter conditions not applied correctly
**Solution**:
1. Check YAML filter syntax uses `_eq` not `=`
2. Verify session variables are propagated
3. Check database relationships are correct

### Issue: Admin Cannot Approve/Update

**Cause**: Admin role permissions not configured for update
**Solution**:
1. Verify admin role has `update_permissions` configured
2. Check columns are listed in `columns` array
3. Verify `check` condition allows the operation

### Issue: Empty Results for Valid Queries

**Cause**: Row-level security filtering out all rows
**Solution**:
1. Verify test data exists in database
2. Check filter conditions match test user IDs
3. Verify `X-Hasura-User-Id` header matches database user

---

## 📝 Quick Reference: Required Headers

### For Testing with cURL

```bash
# User Role
-H "X-Hasura-Role: user" \
-H "X-Hasura-User-Id: 550e8400-e29b-41d4-a716-446655440000" \
-H "X-Hasura-Tenant-Id: safetrust"

# Admin Role
-H "X-Hasura-Role: admin" \
-H "X-Hasura-User-Id: admin-uuid-here" \
-H "X-Hasura-Tenant-Id: safetrust"

# Anonymous Role
-H "X-Hasura-Role: anonymous"
```

### For Frontend Integration

```typescript
// Example: Apollo Client
const client = new ApolloClient({
  link: new HttpLink({
    uri: 'https://your-hasura-endpoint.com/v1/graphql',
    headers: {
      'X-Hasura-Role': userRole, // 'user' | 'admin'
      'X-Hasura-User-Id': userId,
      'X-Hasura-Tenant-Id': 'safetrust',
    },
  }),
  cache: new InMemoryCache(),
});
```

---

## ✅ Acceptance Criteria Verification

- [ ] All 6 tables have permissions configured for user, admin, and anonymous roles
- [ ] Users can ONLY see escrows where they are participants
- [ ] Tenant isolation works - no cross-tenant data access
- [ ] Admin role can verify conditions and view all tenant escrows
- [ ] GraphQL queries automatically filter based on session variables
- [ ] Permission violations return proper error messages
- [ ] No breaking changes to existing migrations
- [ ] Permission tests pass for all scenarios
- [ ] All CRUD operations work correctly per role
- [ ] Sensitive columns hidden from non-admin users

---

## 🔗 References

- [Hasura Permissions Documentation](https://hasura.io/docs/2.0/auth/authorization/permissions/)
- [Row-Level Permissions](https://hasura.io/docs/2.0/auth/authorization/permissions/row-level-permissions/)
- [Roles & Session Variables](https://hasura.io/docs/2.0/auth/authorization/roles-variables/)
- [Authorization Best Practices](https://hasura.io/docs/2.0/auth/authorization/index/)

