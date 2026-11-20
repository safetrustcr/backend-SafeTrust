-- Preserve V1-only values in the existing metadata JSON before removing the
-- typed columns. This makes rollback non-destructive even after reconciliation
-- has populated the new fields.
UPDATE safetrust.trustless_work_escrows
SET escrow_metadata = jsonb_set(
  CASE
    WHEN jsonb_typeof(escrow_metadata) = 'object' THEN escrow_metadata
    ELSE jsonb_build_object('legacyValue', escrow_metadata)
  END,
  '{twV1}',
  CASE
    WHEN jsonb_typeof(escrow_metadata->'twV1') = 'object' THEN escrow_metadata->'twV1'
    ELSE '{}'::jsonb
  END || jsonb_strip_nulls(
    jsonb_build_object(
      'engagementId', engagement_id,
      'approver', approver,
      'serviceProvider', service_provider,
      'platformAddress', platform_address,
      'releaseSigner', release_signer,
      'disputeResolver', dispute_resolver,
      'receiver', receiver,
      'flags', flags
    )
  ),
  true
)
WHERE engagement_id IS NOT NULL
   OR service_provider IS NOT NULL
   OR platform_address IS NOT NULL
   OR release_signer IS NOT NULL
   OR dispute_resolver IS NOT NULL
   OR receiver IS NOT NULL
   OR flags IS NOT NULL;

UPDATE safetrust.escrow_milestones
SET metadata = jsonb_set(
  CASE
    WHEN jsonb_typeof(metadata) = 'object' THEN metadata
    ELSE jsonb_build_object('legacyValue', metadata)
  END,
  '{twV1}',
  CASE
    WHEN jsonb_typeof(metadata->'twV1') = 'object' THEN metadata->'twV1'
    ELSE '{}'::jsonb
  END || jsonb_strip_nulls(
    jsonb_build_object('index', "index", 'evidence', evidence)
  ),
  true
)
WHERE "index" IS NOT NULL OR evidence IS NOT NULL;

ALTER TABLE safetrust.escrow_milestones
  DROP COLUMN evidence,
  DROP COLUMN "index";

ALTER TABLE safetrust.trustless_work_escrows
  DROP COLUMN flags,
  DROP COLUMN receiver,
  DROP COLUMN dispute_resolver,
  DROP COLUMN release_signer,
  DROP COLUMN platform_address,
  DROP COLUMN service_provider,
  DROP COLUMN engagement_id;
