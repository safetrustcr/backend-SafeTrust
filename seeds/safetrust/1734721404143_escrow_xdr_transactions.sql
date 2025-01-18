INSERT INTO escrow_xdr_transactions (
    id, 
    escrow_transaction_id, 
    xdr_type, 
    unsigned_xdr, 
    signed_xdr, 
    status, 
    signing_address, 
    error_message, 
    created_at, 
    updated_at
) VALUES 
(
    uuid_generate_v4(), 
    (SELECT id FROM escrow_transactions LIMIT 1 OFFSET 0), 
    'CREATE_ESCROW', 
    'AAAAAgAAAABxY2hJZDNLQ1NySlJBbWtzdXBlcktleXRGWEhQbGhvWEJFAAAAGQAAAAIAAAABAAAAAQAAAAAAAAAAAAAAAFtcAAAAAQAAAAAAAAACAAAAAHRlc3QAAAAAAQAAAABlc2Nyb3ctYWNjb3VudABkYXRh', 
    NULL, 
    'PENDING', 
    NULL, 
    NULL, 
    now() - INTERVAL '2 days', 
    now() - INTERVAL '1 days'
), 
(
    uuid_generate_v4(), 
    (SELECT id FROM escrow_transactions LIMIT 1 OFFSET 1), 
    'FUND_ESCROW', 
    'AAAAAgAAAABxY2hJZDNLQ1NySlJBbWtzdXBlcktleXRGWEhQbGhvWEJFAAAAGQAAAAEAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAoZGVzdGluYXRpb24tc2VuZGVyQGFjY291bnQuY29tAAAAAAAAAAAAAAA=', 
    NULL, 
    'GENERATED', 
    NULL, 
    NULL, 
    now() - INTERVAL '1 days', 
    now() 
), 
(
    uuid_generate_v4(), 
    (SELECT id FROM escrow_transactions LIMIT 1 OFFSET 2), 
    'COMPLETE_ESCROW', 
    'AAAAAgAAAABxY2hJZDNLQ1NySlJBbWtzdXBlcktleXRGWEhQbGhvWEJFAAAAGQAAAAEAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAoYmVuZWZpY2lhcnktcmVsZWFzZQAAAAAAAAAAAA==', 
    NULL, 
    'CONFIRMED', 
    NULL, 
    NULL, 
    now() - INTERVAL '3 days', 
    now() - INTERVAL '1 days'
),
(
   uuid_generate_v4(), 
    (SELECT id FROM escrow_transactions LIMIT 1 OFFSET 3), 
    'CANCEL_ESCROW', 
    'AAAAAgAAAABxY2hJZDNLQ1NySlJBbWtzdXBlcktleXRGWEhQbGhvWEJFAAAAGQAAAAEAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAoY2FuY2VsLWVzY3JvdwAAAAAAAAAAAAAAA==', 
    NULL, 
    'FAILED', 
    NULL, 
    'Escrow cancelled: Insufficient funds', 
    now() - INTERVAL '2 days', 
    now() 
), 
(
   uuid_generate_v4(), 
    (SELECT id FROM escrow_transactions LIMIT 1 OFFSET 4), 
    'REFUND_ESCROW', 
    'AAAAAgAAAABxY2hJZDNLQ1NySlJBbWtzdXBlcktleXRGWEhQbGhvWEJFAAAAGQAAAAEAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAocmVmdW5kLWVzY3JvdwAAAAAAAAAAAAAAAA=', 
    NULL, 
    'CONFIRMED', 
    NULL, 
    NULL, 
    now() - INTERVAL '3 days', 
    now() - INTERVAL '2 days'
), 
(
   uuid_generate_v4(), 
    (SELECT id FROM escrow_transactions LIMIT 1 OFFSET 5), 
    'CANCEL_ESCROW', 
    'AAAAAgAAAABxY2hJZDNLQ1NySlJBbWtzdXBlcktleXRGWEhQbGhvWEJFAAAAGQAAAAEAAAAAQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAocmVjYW5jZWwtcmVmdW5kLWVzY3JvdwAAAA==', 
    NULL, 
    'FAILED', 
    NULL, 
    'Escrow cancelled: Server error', 
    now() - INTERVAL '1 days', 
    now()
);