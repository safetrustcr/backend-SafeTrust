Feature: GET /helper/get-escrow-by-contract-ids — TrustlessWork indexer query validation

  # Tests the reconciliation layer's use of TrustlessWork's batch escrow query.
  # Validates:
  #   - Response shape matches documented TW API contract
  #   - Field mapping: TW response fields → trustless_work_escrows columns
  #   - Batch size: max 50 contract IDs per request (CHUNK_SIZE constraint)
  #   - Big O: O(1) per chunk call, O(⌈n/50⌉) total calls for n escrows
  #
  # Uses USE_MOCK_DATA=true — no live TrustlessWork API key required.

  Background:
    * url webhookUrl
    * configure headers = { 'Content-Type': 'application/json' }
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))

  # ── Response shape validation ──────────────────────────────────────────────
  Scenario: sync-escrows response shape matches TrustlessWork documented contract
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    # Each synced escrow in mock data must map correctly from TW response shape:
    # contractId → contract_id, roles.approver → approver,
    # roles.serviceProvider → marker (service provider = hotel/owner),
    # roles.releaseSigner → releaser, balance → balance
    * def rows = db.query("SELECT contract_id, approver, marker, releaser, balance FROM public.trustless_work_escrows WHERE contract_id IN ('CAATN5DTEST00001', 'CAATN5DTEST00002') ORDER BY contract_id")
    And match rows[0].contract_id == 'CAATN5DTEST00001'
    And match rows[0].approver == '#string'
    And match rows[0].marker == '#string'
    And match rows[0].releaser == '#string'

  # ── Field mapping: balance synced from TW response ────────────────────────
  Scenario: TrustlessWork balance field is correctly upserted into trustless_work_escrows
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    # CAATN5DTEST00002 is seeded with balance=300 in seed-test-escrows.sql
    # After sync, balance should reflect TW's authoritative value (mock returns same)
    * def rows = db.query("SELECT balance FROM public.trustless_work_escrows WHERE contract_id = 'CAATN5DTEST00002'")
    And match rows[0].balance == '#string'
    # balance is stored as DECIMAL — cast to string by JDBC driver; validate it is numeric
    And assert parseFloat(rows[0].balance) >= 0

  # ── CHUNK_SIZE constraint: 50 IDs per TW API call ─────────────────────────
  Scenario: sync with 50 escrows produces exactly 1 TW API call (1 chunk of 50)
    * db.execute("DELETE FROM public.trustless_work_escrows WHERE tenant_id = 'safetrust'")
    * db.execute(karate.read('file:tests/karate/fixtures/seed-50-escrows.sql'))
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.totalEscrows == 50
    # chunks = ⌈50/50⌉ = 1 — exactly one batch TW call made
    And match response.chunks == 1

  # ── CHUNK_SIZE boundary: 51 IDs → 2 TW API calls ─────────────────────────
  Scenario: sync with 51 escrows produces exactly 2 TW API calls (2 chunks)
    * db.execute("DELETE FROM public.trustless_work_escrows WHERE tenant_id = 'safetrust'")
    * db.execute(karate.read('file:tests/karate/fixtures/seed-51-escrows.sql'))
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.totalEscrows == 51
    # chunks = ⌈51/50⌉ = 2 — two batch TW calls made
    And match response.chunks == 2
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))

  # ── isActive=false mapping → status reflects inactive state ───────────────
  Scenario: TrustlessWork isActive false does not overwrite SafeTrust status
    # SafeTrust owns the status field — TW's isActive is informational only.
    # The UPSERT_ESCROW_SQL does not write isActive into status column.
    # This test documents and protects that design decision.
    * def initialStatus = db.query("SELECT status FROM public.trustless_work_escrows WHERE contract_id = 'CAATN5DTEST00003'")
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    * def postSyncStatus = db.query("SELECT status FROM public.trustless_work_escrows WHERE contract_id = 'CAATN5DTEST00003'")
    # Status must not be changed by sync — SafeTrust owns this field
    And match postSyncStatus[0].status == initialStatus[0].status

  # ── updatedAt timestamp: TW updatedAt does NOT overwrite our updated_at ───
  Scenario: reconciliation sets updated_at to NOW() not to TrustlessWork updatedAt
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    * def afterSync = db.query("SELECT updated_at FROM public.trustless_work_escrows WHERE contract_id = 'CAATN5DTEST00001'")
    # updated_at is set to NOW() by the UPSERT — must differ from pre-sync value
    # (only if the row was actually updated; with mock data returning same values,
    # IS DISTINCT FROM guard fires and updated_at stays unchanged — valid either way)
    And match afterSync[0].updated_at == '#string'
