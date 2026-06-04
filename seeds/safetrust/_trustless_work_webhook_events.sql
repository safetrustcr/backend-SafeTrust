-- Seed data for trustless_work_webhook_events
-- Covers main TrustlessWork webhook event types for local dev/testing
-- contract_id values use CAATN5DTEST... prefix for test data

-- Idempotency: clear existing webhook events
TRUNCATE public.trustless_work_webhook_events CASCADE;

INSERT INTO public.trustless_work_webhook_events (
  contract_id, event_type, payload, signature,
  processed, processed_at, error_message,
  retry_count, max_retries, next_retry_at, tenant_id
) VALUES

-- 1. Escrow created successfully
(
  'CAATN5DTEST00001',
  'escrow.created',
  '{
    "contractId": "CAATN5DTEST00001",
    "engagementId": "ENG-SEED-001",
    "status": "created",
    "amount": 150,
    "asset": "USDC",
    "roles": {
      "approver": "GAWVVSATEST0001APPROVER",
      "serviceProvider": "GAWVVSATEST0001PROVIDER",
      "releaseSigner": "GAWVVSATEST0001RELEASER"
    }
  }'::jsonb,
  'sha256=abc123signature001',
  TRUE, NOW() - INTERVAL '3 days', NULL, 0, 3, NULL, 'safetrust'
),

-- 2. Milestone approved
(
  'CAATN5DTEST00001',
  'milestone.approved',
  '{
    "contractId": "CAATN5DTEST00001",
    "milestoneIndex": 0,
    "description": "Check-in milestone",
    "approvedBy": "GAWVVSATEST0001APPROVER",
    "status": "approved"
  }'::jsonb,
  'sha256=abc123signature002',
  TRUE, NOW() - INTERVAL '2 days', NULL, 0, 3, NULL, 'safetrust'
),

-- 3. Escrow funded
(
  'CAATN5DTEST00002',
  'escrow.funded',
  '{
    "contractId": "CAATN5DTEST00002",
    "engagementId": "ENG-SEED-002",
    "amount": 300,
    "balance": 300,
    "asset": "USDC",
    "status": "funded"
  }'::jsonb,
  'sha256=abc123signature003',
  TRUE, NOW() - INTERVAL '1 day', NULL, 0, 3, NULL, 'safetrust'
),

-- 4. Dispute raised (unprocessed)
(
  'CAATN5DTEST00002',
  'escrow.disputed',
  '{
    "contractId": "CAATN5DTEST00002",
    "raisedBy": "GAWVVSATEST0002APPROVER",
    "reason": "Service not delivered as agreed",
    "status": "disputed"
  }'::jsonb,
  'sha256=abc123signature004',
  FALSE, NULL, NULL, 0, 3, NULL, 'safetrust'
),

-- 5. Failed processing with retry
(
  'CAATN5DTEST00003',
  'escrow.completed',
  '{
    "contractId": "CAATN5DTEST00003",
    "engagementId": "ENG-SEED-003",
    "status": "completed",
    "releasedAmount": 200
  }'::jsonb,
  'sha256=abc123signature005',
  FALSE, NULL, 'Connection timeout while updating escrow status',
  2, 3, NOW() + INTERVAL '10 minutes', 'safetrust'
),

-- 6. Escrow cancelled
(
  'CAATN5DTEST00003',
  'escrow.cancelled',
  '{
    "contractId": "CAATN5DTEST00003",
    "cancelledBy": "GAWVVSATEST0003RELEASER",
    "reason": "Booking cancelled by guest",
    "status": "cancelled"
  }'::jsonb,
  'sha256=abc123signature006',
  TRUE, NOW() - INTERVAL '6 hours', NULL, 0, 3, NULL, 'safetrust'
);
