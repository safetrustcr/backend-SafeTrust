-- Trustless Work V1 escrow shape.
--
-- `id` remains SafeTrust's internal UUID primary key. `engagement_id` is the
-- external Trustless Work identifier and must never be used as the internal PK.
-- All new columns are nullable so existing escrow rows remain valid and TW-01
-- reconciliation can populate them without a destructive backfill.

ALTER TABLE safetrust.trustless_work_escrows
  ADD COLUMN engagement_id TEXT,
  ADD COLUMN service_provider TEXT,
  ADD COLUMN platform_address TEXT,
  ADD COLUMN release_signer TEXT,
  ADD COLUMN dispute_resolver TEXT,
  ADD COLUMN receiver TEXT,
  ADD COLUMN flags JSONB;

ALTER TABLE safetrust.escrow_milestones
  ADD COLUMN "index" INTEGER,
  ADD COLUMN evidence TEXT;

COMMENT ON COLUMN safetrust.trustless_work_escrows.engagement_id IS
  'External Trustless Work V1 escrow engagement identifier; distinct from SafeTrust id UUID';
COMMENT ON COLUMN safetrust.trustless_work_escrows.approver IS
  'Trustless Work V1 approver role address';
COMMENT ON COLUMN safetrust.trustless_work_escrows.service_provider IS
  'Trustless Work V1 serviceProvider role address';
COMMENT ON COLUMN safetrust.trustless_work_escrows.platform_address IS
  'Trustless Work V1 platformAddress role address';
COMMENT ON COLUMN safetrust.trustless_work_escrows.release_signer IS
  'Trustless Work V1 releaseSigner role address';
COMMENT ON COLUMN safetrust.trustless_work_escrows.dispute_resolver IS
  'Trustless Work V1 disputeResolver role address';
COMMENT ON COLUMN safetrust.trustless_work_escrows.receiver IS
  'Trustless Work V1 receiver role address for single-release escrows';
COMMENT ON COLUMN safetrust.trustless_work_escrows.flags IS
  'Raw Trustless Work V1 flags. Application status precedence: isCancelled -> cancelled; isDisputed -> disputed; isCompleted -> completed; isPending -> pending_funding; otherwise created';
COMMENT ON COLUMN safetrust.trustless_work_escrows.status IS
  'SafeTrust compatibility status derived by the application from V1 flags using: isCancelled, isDisputed, isCompleted, isPending, then created';
COMMENT ON COLUMN safetrust.escrow_milestones."index" IS
  'Zero-based milestone position supplied by Trustless Work V1';
COMMENT ON COLUMN safetrust.escrow_milestones.evidence IS
  'Trustless Work V1 milestone evidence text';
