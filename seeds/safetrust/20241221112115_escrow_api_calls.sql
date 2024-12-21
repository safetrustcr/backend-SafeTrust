-- Insert seed data into the escrow_api_calls table, covering different API endpoints, HTTP methods, and status codes

WITH escrow_txns AS (
    SELECT id FROM escrow_transactions LIMIT 5
)

-- Successful POST request (status 201)
INSERT INTO escrow_api_calls (
    escrow_transaction_id, 
    endpoint, 
    method, 
    request_body, 
    http_status_code, 
    response_body, 
    error_details, 
    created_at
)
VALUES
(
    (SELECT id FROM escrow_txns OFFSET 0 LIMIT 1),
    '/api/escrow/create',
    'POST',
    '{"amount": 5000, "currency": "USD", "buyer_id": "12345", "seller_id": "67890"}',
    201,
    '{"status": "success", "escrow_id": "uuid-1"}',
    NULL,
    NOW() - INTERVAL '10 days'
),
-- Successful GET request (status 200)
(
    (SELECT id FROM escrow_txns OFFSET 1 LIMIT 1),
    '/api/escrow/status',
    'GET',
    '{"escrow_id": "uuid-1"}',
    200,
    '{"status": "active", "escrow_id": "uuid-1", "amount": 5000, "currency": "USD"}',
    NULL,
    NOW() - INTERVAL '5 days'
),
-- PUT request (status 200)
(
    (SELECT id FROM escrow_txns OFFSET 2 LIMIT 1),
    '/api/escrow/update',
    'PUT',
    '{"escrow_id": "uuid-1", "status": "completed"}',
    200,
    '{"status": "success", "escrow_id": "uuid-1", "updated_at": "2024-12-21"}',
    NULL,
    NOW() - INTERVAL '3 days'
),
-- DELETE request (status 204)
(
    (SELECT id FROM escrow_txns OFFSET 3 LIMIT 1),
    '/api/escrow/cancel',
    'DELETE',
    '{"escrow_id": "uuid-1"}',
    204,
    '{"status": "success", "escrow_id": "uuid-1"}',
    NULL,
    NOW() - INTERVAL '2 days'
),
-- Client error (status 400)
(
    (SELECT id FROM escrow_txns OFFSET 4 LIMIT 1),
    '/api/escrow/create',
    'POST',
    '{"amount": -5000, "currency": "USD", "buyer_id": "12345", "seller_id": "67890"}',
    400,
    '{"status": "error", "message": "Invalid amount"}',
    '{"error_code": "INVALID_AMOUNT"}',
    NOW() - INTERVAL '1 day'
),
-- Server error (status 500)
(
    (SELECT id FROM escrow_txns OFFSET 4 LIMIT 1),
    '/api/escrow/status',
    'GET',
    '{"escrow_id": "invalid-uuid"}',
    500,
    '{"status": "error", "message": "Internal Server Error"}',
    '{"error_code": "SERVER_ERROR"}',
    NOW() - INTERVAL '1 hour'
);
