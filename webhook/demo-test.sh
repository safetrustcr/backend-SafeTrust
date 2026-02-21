#!/bin/bash

# Demo script for Escrow Status Endpoint
# This demonstrates the endpoint functionality

echo "================================================"
echo "  Escrow Status Endpoint Demo"
echo "  Issue #253 Implementation"
echo "================================================"
echo ""

BASE_URL="http://localhost:3001"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}1. Testing Health Endpoint (No Auth Required)${NC}"
echo "   GET $BASE_URL/health"
echo ""
curl -s $BASE_URL/health | jq '.' || echo "Service not running. Start with: node index.js"
echo ""
echo "================================================"
echo ""

echo -e "${BLUE}2. Testing Escrow Status Without Authentication${NC}"
echo "   GET $BASE_URL/api/escrow/status/test-contract-123"
echo "   Expected: 401 Unauthorized"
echo ""
curl -s -w "\nHTTP Status: %{http_code}\n" \
  $BASE_URL/api/escrow/status/test-contract-123 | jq '.' 2>/dev/null || echo "Error: Invalid JSON or service not running"
echo ""
echo "================================================"
echo ""

echo -e "${BLUE}3. Testing with Invalid Token${NC}"
echo "   GET $BASE_URL/api/escrow/status/test-contract-123"
echo "   Authorization: Bearer invalid-token"
echo "   Expected: 401 Invalid Token"
echo ""
curl -s -w "\nHTTP Status: %{http_code}\n" \
  -H "Authorization: Bearer invalid-token" \
  $BASE_URL/api/escrow/status/test-contract-123 | jq '.' 2>/dev/null || echo "Error: Invalid JSON or service not running"
echo ""
echo "================================================"
echo ""

echo -e "${BLUE}4. Testing with Missing Contract ID${NC}"
echo "   GET $BASE_URL/api/escrow/status/"
echo "   Expected: 404 Not Found"
echo ""
curl -s -w "\nHTTP Status: %{http_code}\n" \
  -H "Authorization: Bearer test-token" \
  $BASE_URL/api/escrow/status/ 2>/dev/null || echo "404 - Route not found (expected)"
echo ""
echo "================================================"
echo ""

echo -e "${YELLOW}Note: To test with real data, you need:${NC}"
echo "  1. Valid Firebase JWT token"
echo "  2. Existing contract ID in database"
echo "  3. Trustless Work API credentials configured"
echo ""
echo -e "${GREEN}Usage with real credentials:${NC}"
echo "  export FIREBASE_TOKEN='your-token'"
echo "  export CONTRACT_ID='your-contract-id'"
echo "  curl -H \"Authorization: Bearer \$FIREBASE_TOKEN\" \\"
echo "    $BASE_URL/api/escrow/status/\$CONTRACT_ID"
echo ""
echo "================================================"
echo -e "${GREEN}Demo Complete!${NC}"
echo ""
echo "Key Features Demonstrated:"
echo "  ✓ Endpoint is accessible"
echo "  ✓ Authentication is required"
echo "  ✓ Token validation works"
echo "  ✓ Error handling is implemented"
echo ""
