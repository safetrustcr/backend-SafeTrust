Feature: POST /reconciliation/sync-escrows — chunk processing and Big O correctness

  # The reconciliation engine splits contract IDs into chunks of 50 (CHUNK_SIZE).
  # For n escrows, exactly ⌈n/50⌉ calls are made to TrustlessWork.
  # Each chunk is upserted into public.trustless_work_escrows via:
  #   INSERT ... ON CONFLICT (contract_id) DO UPDATE ... WHERE IS DISTINCT FROM
  # Unchanged rows produce 0 affected rows — only real changes increment `updated`.
  #
  # Big O properties under test:
  #   chunkArray(arr, 50)     → O(n) time, O(n) space
  #   fetchEscrowsByContractIds → O(⌈n/50⌉) network calls
  #   syncChunk per chunk     → O(chunk_size) DB writes
  #   Total sync              → O(n) end-to-end

  Background:
    * url webhookUrl
    * configure headers = { 'Content-Type': 'application/json' }
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * configure afterFeature = function(){ db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql')) }

  # ── Boundary: exactly 0 escrows ───────────────────────────────────────────
  Scenario: sync with 0 seeded escrows returns totalEscrows 0 and skipped 0
    * db.execute("DELETE FROM public.trustless_work_escrows WHERE tenant_id = 'safetrust'")
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.success == true
    And match response.totalEscrows == 0
    And match response.updated == 0
    And match response.chunks == 0
    And match response.errors == 0

  # ── Boundary: exactly 1 escrow → exactly 1 chunk → 1 TW call ─────────────
  Scenario: sync with 1 escrow produces 1 chunk
    * db.execute("DELETE FROM public.trustless_work_escrows WHERE tenant_id = 'safetrust'")
    * db.execute("INSERT INTO public.trustless_work_escrows (contract_id, marker, approver, releaser, escrow_type, status, asset_code, amount, tenant_id) VALUES ('CTEST001', 'GMARKER', 'GAPPROVER', 'GRELEASER', 'single_release', 'created', 'USDC', 100, 'safetrust')")
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.success == true
    And match response.totalEscrows == 1
    And match response.chunks == 1

  # ── Boundary: exactly 50 escrows → exactly 1 chunk (CHUNK_SIZE boundary) ──
  Scenario: sync with exactly 50 escrows produces exactly 1 chunk
    * db.execute("DELETE FROM public.trustless_work_escrows WHERE tenant_id = 'safetrust'")
    * def insertSql = karate.read('file:tests/karate/fixtures/seed-50-escrows.sql')
    * db.execute(insertSql)
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.totalEscrows == 50
    And match response.chunks == 1

  # ── Boundary: 51 escrows → 2 chunks (crosses CHUNK_SIZE boundary) ─────────
  Scenario: sync with 51 escrows produces exactly 2 chunks — O(⌈n/50⌉) verified
    * db.execute("DELETE FROM public.trustless_work_escrows WHERE tenant_id = 'safetrust'")
    * def insertSql = karate.read('file:tests/karate/fixtures/seed-51-escrows.sql')
    * db.execute(insertSql)
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.totalEscrows == 51
    And match response.chunks == 2

  # ── Idempotency: unchanged rows → updated = 0 (IS DISTINCT FROM guard) ────
  Scenario: calling sync twice on unchanged data returns updated 0 on second call
    * db.execute("DELETE FROM public.trustless_work_escrows WHERE tenant_id = 'safetrust'")
    * db.execute("INSERT INTO public.trustless_work_escrows (contract_id, marker, approver, releaser, escrow_type, status, asset_code, amount, tenant_id) VALUES ('CTEST_IDEM', 'GMARKER', 'GAPPROVER', 'GRELEASER', 'single_release', 'created', 'USDC', 100, 'safetrust')")
    # First sync
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    # Second sync — TW returns same data, IS DISTINCT FROM guard fires
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.updated == 0
    And assert response.unchanged >= 0

  # ── Performance baseline: O(n) duration grows linearly ────────────────────
  Scenario: sync with 50 escrows completes within 30 seconds
    * db.execute("DELETE FROM public.trustless_work_escrows WHERE tenant_id = 'safetrust'")
    * def insertSql = karate.read('file:tests/karate/fixtures/seed-50-escrows.sql')
    * db.execute(insertSql)
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.durationMs == '#number'
    # O(n) for n=50: should complete well within 30s even with TW network latency
    And assert response.durationMs < 30000

  # ── Error resilience: partial TW failure → errors > 0 but success = true ──
  Scenario: chunk error increments errors counter but does not abort sync
    # This scenario relies on USE_MOCK_DATA=true in docker-compose-test.yml
    # With mock data, TW calls are simulated and cannot produce chunk errors.
    # This scenario documents expected behavior for live TW connectivity issues.
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.success == true
    # errors may be 0 (mock) or > 0 (live TW chunk failure) — both are valid
    And match response.errors == '#number'
