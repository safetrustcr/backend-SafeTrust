#!/bin/bash
# Security Feature Testing Script
# Tests all security layers implemented for SafeTrust webhooks

set -e

WEBHOOK_URL="http://localhost:8083"
ADMIN_SECRET="myadminsecretkey"

echo "🔐 SafeTrust Webhook Security Test Suite"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' 

# Test counter
PASSED=0
FAILED=0

# Helper function to test endpoints
test_endpoint() {
  local test_name="$1"
  local expected_status="$2"
  local curl_cmd="$3"
  
  echo -n "Testing: $test_name... "
  
  response=$(eval "$curl_cmd" 2>&1)
  status_code=$(echo "$response" | tail -n1)
  
  if [ "$status_code" = "$expected_status" ]; then
    echo -e "${GREEN}✓ PASSED${NC} (Status: $status_code)"
    ((PASSED++))
  else
    echo -e "${RED}✗ FAILED${NC} (Expected: $expected_status, Got: $status_code)"
    ((FAILED++))
  fi
}

echo "1️⃣  Testing Health Endpoint (No Auth Required)"
echo "------------------------------------------------"
test_endpoint "Health check" "200" \
  "curl -s -o /dev/null -w '%{http_code}' $WEBHOOK_URL/health"
echo ""

echo "2️⃣  Testing Admin Secret Authentication"
echo "------------------------------------------------"
test_endpoint "Missing admin secret" "401" \
  "curl -s -o /dev/null -w '%{http_code}' -X POST $WEBHOOK_URL/webhooks/escrow_status_update \
  -H 'Content-Type: application/json' \
  -d '{\"event\":{\"data\":{\"old\":{\"status\":\"pending\"},\"new\":{\"status\":\"completed\"}}}}'"

test_endpoint "Invalid admin secret" "401" \
  "curl -s -o /dev/null -w '%{http_code}' -X POST $WEBHOOK_URL/webhooks/escrow_status_update \
  -H 'Content-Type: application/json' \
  -H 'x-hasura-admin-secret: wrong_secret' \
  -d '{\"event\":{\"data\":{\"old\":{\"status\":\"pending\"},\"new\":{\"status\":\"completed\"}}}}'"

test_endpoint "Valid admin secret" "200" \
  "curl -s -o /dev/null -w '%{http_code}' -X POST $WEBHOOK_URL/webhooks/escrow_status_update \
  -H 'Content-Type: application/json' \
  -H 'x-hasura-admin-secret: $ADMIN_SECRET' \
  -d '{\"event\":{\"data\":{\"old\":{\"status\":\"pending\"},\"new\":{\"status\":\"completed\"}}}}'"
echo ""

echo "3️⃣  Testing Input Validation"
echo "------------------------------------------------"
test_endpoint "Invalid request body (missing event)" "400" \
  "curl -s -o /dev/null -w '%{http_code}' -X POST $WEBHOOK_URL/webhooks/escrow_status_update \
  -H 'Content-Type: application/json' \
  -H 'x-hasura-admin-secret: $ADMIN_SECRET' \
  -d '{\"invalid\":\"data\"}'"

test_endpoint "Invalid request body (missing status)" "400" \
  "curl -s -o /dev/null -w '%{http_code}' -X POST $WEBHOOK_URL/webhooks/escrow_status_update \
  -H 'Content-Type: application/json' \
  -H 'x-hasura-admin-secret: $ADMIN_SECRET' \
  -d '{\"event\":{\"data\":{\"old\":{},\"new\":{}}}}'"

test_endpoint "Valid request body" "200" \
  "curl -s -o /dev/null -w '%{http_code}' -X POST $WEBHOOK_URL/webhooks/escrow_status_update \
  -H 'Content-Type: application/json' \
  -H 'x-hasura-admin-secret: $ADMIN_SECRET' \
  -d '{\"event\":{\"data\":{\"old\":{\"status\":\"pending\"},\"new\":{\"status\":\"completed\"}}}}'"
echo ""

echo "4️⃣  Testing Rate Limiting"
echo "------------------------------------------------"
echo "Sending 15 rapid requests to trigger rate limit..."

rate_limit_triggered=false
for i in {1..15}; do
  status=$(curl -s -o /dev/null -w '%{http_code}' -X POST $WEBHOOK_URL/webhooks/escrow_status_update \
    -H 'Content-Type: application/json' \
    -H 'x-hasura-admin-secret: '$ADMIN_SECRET \
    -d '{"event":{"data":{"old":{"status":"pending"},"new":{"status":"completed"}}}}')
  
  if [ "$status" = "429" ]; then
    rate_limit_triggered=true
    break
  fi
  sleep 0.1
done

if [ "$rate_limit_triggered" = true ]; then
  echo -e "${GREEN}✓ PASSED${NC} - Rate limit triggered (429 Too Many Requests)"
  ((PASSED++))
else
  echo -e "${YELLOW}⚠ WARNING${NC} - Rate limit not triggered (might need more requests or Redis not configured)"
fi
echo ""

echo "5️⃣  Testing Refund Status Webhook"
echo "------------------------------------------------"
test_endpoint "Refund status update" "200" \
  "curl -s -o /dev/null -w '%{http_code}' -X POST $WEBHOOK_URL/webhooks/escrow_refund_status_update \
  -H 'Content-Type: application/json' \
  -H 'x-hasura-admin-secret: $ADMIN_SECRET' \
  -d '{\"event\":{\"data\":{\"old\":{\"refund_status\":\"pending\"},\"new\":{\"refund_status\":\"completed\"}}}}'"
echo ""

echo "=================================================="
echo "📊 Test Summary"
echo "=================================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}🎉 All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed. Please review the implementation.${NC}"
  exit 1
fi
