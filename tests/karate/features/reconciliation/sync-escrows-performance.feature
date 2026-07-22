Feature: POST /reconciliation/sync-escrows — Big O linear scaling verification

  # Validates that sync duration grows linearly with n (number of escrows).
  #
  # Theory:
  #   chunkArray(n, 50)            → O(n) time
  #   fetchEscrowsByContractIds    → O(⌈n/50⌉) network calls
  #   syncChunk per chunk          → O(k) DB writes, k <= 50
  #   Total sync                   → O(n) dominated by DB writes
  #
  # Test strategy:
  #   Run sync at n=1, 50, 100, 200.
  #   Assert absolute ceiling per n (generous, network-tolerant).
  #   Assert that durationMs(n=200) / durationMs(n=1) < 400
  #   (allows for constant factors but rejects O(n²) which would give ratio ~40000)
  #
  # These tests use USE_MOCK_DATA=true so TW network calls are simulated.
  # The DB write path (syncChunk → UPSERT) is real.
  #
  # Isolation: the sync handler only selects tenant_id='safetrust', so we cannot
  # use a separate tenant without changing production code. Instead we stash
  # non-benchmark safetrust rows to tenant 'safetrust_perf_stash', seed only
  # PERF_/SCALE_/CTEST_CHUNK fixtures, then restore on afterScenario teardown
  # (runs even when assertions fail).

  Background:
    * url webhookUrl
    * configure headers = { 'Content-Type': 'application/json' }
    * def clearPerfFixtures =
    """
    function() {
      db.execute("DELETE FROM public.trustless_work_escrows WHERE contract_id LIKE 'PERF_TEST_%' OR contract_id LIKE 'SCALE_TEST_%' OR contract_id LIKE 'CTEST_CHUNK_%'");
    }
    """
    * def stashNonBenchmarkEscrows =
    """
    function() {
      // Park other safetrust rows so chunk counts equal ⌈n/50⌉ for this scenario
      // without DELETE-ing shared suite data.
      db.execute("UPDATE public.trustless_work_escrows SET tenant_id = 'safetrust_perf_stash' WHERE tenant_id = 'safetrust'");
    }
    """
    * def restoreStashedEscrows =
    """
    function() {
      db.execute("UPDATE public.trustless_work_escrows SET tenant_id = 'safetrust' WHERE tenant_id = 'safetrust_perf_stash'");
    }
    """
    * def teardownPerf =
    """
    function() {
      clearPerfFixtures();
      restoreStashedEscrows();
    }
    """
    * def prepareBenchmark =
    """
    function() {
      clearPerfFixtures();
      stashNonBenchmarkEscrows();
    }
    """
    # Failure-safe: always drop benchmark fixtures and restore stashed rows
    * configure afterScenario = function(){ teardownPerf(); }

  Scenario: n=1 escrow — baseline O(1) sync duration < 5s
    * prepareBenchmark()
    * db.execute("INSERT INTO public.trustless_work_escrows (contract_id, marker, approver, releaser, escrow_type, status, asset_code, amount, tenant_id) VALUES ('PERF_TEST_001', 'GMARKER', 'GAPPROVER', 'GRELEASER', 'single_release', 'created', 'USDC', 100, 'safetrust') ON CONFLICT DO NOTHING")
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.success == true
    And match response.totalEscrows == 1
    And match response.chunks == 1
    And match response.errors == 0
    And assert response.durationMs < 5000
    # Persist baseline for the n=200 O(n) ratio check (scenarios do not share karate.set)
    * eval java.lang.System.setProperty('syncPerfBaselineMs', '' + response.durationMs)
    * karate.set('baseline', response.durationMs)

  Scenario: n=50 escrow — O(n) sync duration < 15s and chunks == 1
    * prepareBenchmark()
    # seed-50-escrows.sql currently ships 42 CTEST_CHUNK rows; pad to exactly 50
    * db.execute(karate.read('file:tests/karate/fixtures/seed-50-escrows.sql'))
    * db.execute("INSERT INTO public.trustless_work_escrows (contract_id, marker, approver, releaser, escrow_type, status, asset_code, amount, tenant_id) SELECT 'PERF_TEST_PAD_' || LPAD(i::text, 3, '0'), 'GMARKER', 'GAPPROVER', 'GRELEASER', 'single_release', 'created', 'USDC', 100, 'safetrust' FROM generate_series(1, 8) AS s(i) ON CONFLICT DO NOTHING")
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.success == true
    And match response.totalEscrows == 50
    And match response.chunks == 1
    And match response.errors == 0
    And assert response.durationMs < 15000

  Scenario: n=100 escrow — O(n) sync duration < 25s and chunks == 2
    * prepareBenchmark()
    * db.execute(karate.read('file:tests/karate/fixtures/seed-50-escrows.sql'))
    * db.execute("INSERT INTO public.trustless_work_escrows (contract_id, marker, approver, releaser, escrow_type, status, asset_code, amount, tenant_id) SELECT 'PERF_TEST_EXTRA_' || LPAD(i::text, 3, '0'), 'GMARKER', 'GAPPROVER', 'GRELEASER', 'single_release', 'created', 'USDC', 100, 'safetrust' FROM generate_series(1, 50) AS s(i) ON CONFLICT DO NOTHING")
    # 42 (fixture) + 50 extras + 8 pad = 100
    * db.execute("INSERT INTO public.trustless_work_escrows (contract_id, marker, approver, releaser, escrow_type, status, asset_code, amount, tenant_id) SELECT 'PERF_TEST_PAD_' || LPAD(i::text, 3, '0'), 'GMARKER', 'GAPPROVER', 'GRELEASER', 'single_release', 'created', 'USDC', 100, 'safetrust' FROM generate_series(1, 8) AS s(i) ON CONFLICT DO NOTHING")
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.success == true
    And match response.totalEscrows == 100
    And match response.chunks == 2
    And match response.errors == 0
    And assert response.durationMs < 25000

  Scenario: n=200 escrow — O(n) scaling ratio vs n=1 must be < 400 (rejects O(n²))
    * prepareBenchmark()
    * db.execute("INSERT INTO public.trustless_work_escrows (contract_id, marker, approver, releaser, escrow_type, status, asset_code, amount, tenant_id) SELECT 'SCALE_TEST_' || LPAD(i::text, 3, '0'), 'GMARKER', 'GAPPROVER', 'GRELEASER', 'single_release', 'created', 'USDC', 100, 'safetrust' FROM generate_series(1, 200) AS s(i) ON CONFLICT DO NOTHING")
    Given path '/reconciliation/sync-escrows'
    When method POST
    Then status 200
    And match response.success == true
    And match response.totalEscrows == 200
    And match response.chunks == 4
    And match response.errors == 0
    And assert response.durationMs < 50000
    # O(n) check: duration for 200 escrows should be < 400x duration for 1 escrow
    # O(n²) would give ~40000x ratio — far exceeds this bound
    # This assertion catches quadratic regressions without requiring exact timing
    # Baseline is set by the n=1 scenario via System property (karate.set does not span scenarios)
    * def baselineStr = java.lang.System.getProperty('syncPerfBaselineMs')
    * if (baselineStr == null) karate.fail('syncPerfBaselineMs missing — n=1 scenario must run first in this feature')
    * def baseline = java.lang.Double.parseDouble(baselineStr)
    * def ratio = response.durationMs / baseline
    * print 'sync O(n) ratio n=200/n=1 =', ratio, 'baselineMs=', baseline, 'durationMs=', response.durationMs
    And assert ratio < 400
