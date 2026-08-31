Feature: Full escrow lifecycle state machine — O(steps) sequential validation

  # Validates the complete single-release escrow lifecycle in order:
  #   initialize → fund → approve-milestone → release-funds
  #
  # Also validates the dispute branch:
  #   initialize → fund → dispute → resolve-dispute
  #
  # Big O properties under test:
  #   Each status transition: O(1) — single Hasura mutation, single DB write
  #   Full lifecycle (n=1 milestone): O(4) transitions = O(n_steps)
  #   Dispute branch: O(4) transitions (init → fund → dispute → resolve)
  #   Total wall clock for full lifecycle: must complete < 10s (network-bound)
  #
  # This feature is ORDER-DEPENDENT by design for Steps 1–4 / 2b.
  # Do not reorder those scenarios.
  #
  # Caveats vs naive Background DELETE:
  #   Karate runs Background before EVERY Scenario. Deleting lifecycle
  #   contract IDs in Background would wipe Step 1's row before Step 2.
  #   Cleanup runs once at feature start (Step 1) and again in afterFeature.
  #
  # Auth: every webhook call must HMAC-sign the exact request body string
  # (same pattern as fund.feature / approve-milestone.feature).
  #
  # Idempotency caveat (handlers):
  #   logAndCheckWebhookEvent short-circuits on (contract_id, event_type) with
  #   processed=true → 200 before Hasura status filters run. Status-guard
  #   assertions clear the relevant webhook_events row first so the mutation
  #   path (and its 404) is actually exercised.

  Background:
    * url webhookUrl
    * configure headers = function(){ return { 'Content-Type': 'application/json', 'x-trustlesswork-timestamp': pendingTrustlessWorkTimestamp() } }
    * def lifecycleContractId = 'LIFECYCLE_TEST_CONTRACT_001'
    * def disputeContractId = 'DISPUTE_TEST_CONTRACT_001'
    * def timingContractId = 'TIMING_TEST_001'
    * def marker = 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z'
    * def approver = 'GAPPROVER111WALLETADDRESS111111111111111111111111111111111'
    * def releaser = 'GRELEASER111WALLETADDRESS111111111111111111111111111111111'
    * def resolver = 'GRESOLVER111WALLETADDRESS111111111111111111111111111111111'
    # Hardcode IDs inside JS helpers — Karate closures do not always capture
    # Background `def` bindings reliably across afterFeature.
    * def cleanupLifecycleFixtures =
    """
    function() {
      var ids = "('LIFECYCLE_TEST_CONTRACT_001','DISPUTE_TEST_CONTRACT_001','TIMING_TEST_001')";
      // Cascades escrow_milestones; also drop webhook idempotency rows for these contracts.
      db.execute("DELETE FROM safetrust.trustless_work_webhook_events WHERE contract_id IN " + ids);
      db.execute("DELETE FROM safetrust.trustless_work_escrows WHERE contract_id IN " + ids);
    }
    """
    # Failure-safe: remove this feature's fixtures even if a later scenario fails.
    # Must NOT run between Steps 1–4 (would break order dependence), so we only
    # clean at feature end — not afterScenario.
    * configure afterFeature = function(){ cleanupLifecycleFixtures(); }

  # ── Step 1: Initialize ────────────────────────────────────────────────────
  Scenario: Step 1 — initialize creates escrow with status created
    * cleanupLifecycleFixtures()
    * def body =
    """
    {
      "contract_id": "#(lifecycleContractId)",
      "marker": "#(marker)",
      "approver": "#(approver)",
      "releaser": "#(releaser)",
      "amount": 1200.00,
      "escrow_type": "single_release",
      "asset_code": "USDC"
    }
    """
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/initialize'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 200
    And match response.received == true
    * def rows = db.query("SELECT status, (CASE WHEN balance = 0::numeric THEN '1' ELSE '0' END) AS balance_is_zero, amount FROM safetrust.trustless_work_escrows WHERE contract_id = '" + lifecycleContractId + "'")
    And match rows[0].status == 'created'
    And match rows[0].balance_is_zero == '1'
    And match rows[0].amount == '1200.0000000'

  # ── Step 2: Fund — O(1) transition, only valid from created/pending_funding ─
  Scenario: Step 2 — fund transitions status to funded and sets balance
    * def body = { "contractId": "#(lifecycleContractId)", "signer": "#(approver)", "amount": 1200.00 }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 200
    And match response.received == true
    * def rows = db.query("SELECT status, balance FROM safetrust.trustless_work_escrows WHERE contract_id = '" + lifecycleContractId + "'")
    And match rows[0].status == 'funded'
    And match rows[0].balance == '1200.0000000'

  # ── Guard: fund is status-gated — cannot fund a funded escrow ─────────────
  Scenario: Step 2b — funding an already-funded escrow returns 404 (status guard)
    # IMPORTANT: webhook idempotency short-circuits on (contract_id, event_type)
    # before the Hasura status filter runs. A second identical fund callback would
    # return 200 { received: true } without testing the status guard. Clear the
    # processed escrow.funded event so this request exercises the mutation path.
    * db.execute("DELETE FROM safetrust.trustless_work_webhook_events WHERE contract_id = '" + lifecycleContractId + "' AND event_type = 'escrow.funded'")
    * def body = { "contractId": "#(lifecycleContractId)", "signer": "#(approver)", "amount": 1200.00 }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    # status is 'funded' — not in ['created', 'pending_funding'] — returns 404
    Then status 404
    And match response.error contains 'Escrow not found'
    # Guard must not mutate funded state / balance
    * def rows = db.query("SELECT status, balance FROM safetrust.trustless_work_escrows WHERE contract_id = '" + lifecycleContractId + "'")
    And match rows[0].status == 'funded'
    And match rows[0].balance == '1200.0000000'

  # ── Step 3: Approve milestone — O(2) DB writes: milestone + escrow ────────
  Scenario: Step 3 — approve-milestone updates milestone and advances escrow to milestone_approved
    * def milestoneEscrowId = db.query("SELECT id FROM safetrust.trustless_work_escrows WHERE contract_id = '" + lifecycleContractId + "'")[0].id
    * db.execute("INSERT INTO safetrust.escrow_milestones (escrow_id, milestone_id, description, amount, status, tenant_id) VALUES ('" + milestoneEscrowId + "', 'check_in', 'Test milestone', 1200.0, 'pending', 'safetrust') ON CONFLICT (escrow_id, milestone_id) DO NOTHING")
    * def body =
    """
    {
      "contractId": "#(lifecycleContractId)",
      "milestoneId": "check_in",
      "approver": "#(approver)",
      "flag": true
    }
    """
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/approve-milestone'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 200
    And match response.received == true
    * def milestone = db.query("SELECT status, approved_by FROM safetrust.escrow_milestones WHERE milestone_id = 'check_in' AND escrow_id = '" + milestoneEscrowId + "'")
    And match milestone[0].status == 'approved'
    And match milestone[0].approved_by == approver
    * def escrow = db.query("SELECT status, balance FROM safetrust.trustless_work_escrows WHERE contract_id = '" + lifecycleContractId + "'")
    And match escrow[0].status == 'milestone_approved'
    # Approval must not zero / alter funded balance
    And match escrow[0].balance == '1200.0000000'

  # ── Step 4: Release funds — O(1) transition, balance zeroed ───────────────
  Scenario: Step 4 — release-funds completes escrow and zeroes balance
    * def body = { "contractId": "#(lifecycleContractId)", "releaseSigner": "#(releaser)" }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/release-funds'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 200
    And match response.received == true
    * def rows = db.query("SELECT status, (CASE WHEN balance = 0::numeric THEN '1' ELSE '0' END) AS balance_is_zero FROM safetrust.trustless_work_escrows WHERE contract_id = '" + lifecycleContractId + "'")
    And match rows[0].status == 'completed'
    And match rows[0].balance_is_zero == '1'
    # Post-completion: re-fund must still be rejected (status guard holds).
    # Clear idempotency row so we hit the Hasura status filter, not the 200 duplicate path.
    * db.execute("DELETE FROM safetrust.trustless_work_webhook_events WHERE contract_id = '" + lifecycleContractId + "' AND event_type = 'escrow.funded'")
    * def fundAgain = { "contractId": "#(lifecycleContractId)", "signer": "#(approver)", "amount": 1200.00 }
    * def fundAgainStr = JSON.stringify(fundAgain)
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(fundAgainStr)
    And request fundAgainStr
    When method POST
    Then status 404

  # ── Performance: full 4-step lifecycle completes in O(steps) wall-clock ───
  Scenario: Full lifecycle timing — 4 transitions complete within 10 seconds total
    # Measures initialize → fund → approve-milestone → release-funds (true O(4)).
    # Issue draft skipped approve-milestone; that would only prove O(3) and would
    # not exercise the milestone_approved state at all.
    * db.execute("DELETE FROM safetrust.trustless_work_escrows WHERE contract_id = '" + timingContractId + "'")
    * def start = Java.type('java.lang.System').currentTimeMillis()

    # 1) Initialize
    * def initBody =
    """
    {
      "contract_id": "#(timingContractId)",
      "marker": "#(marker)",
      "approver": "#(approver)",
      "releaser": "#(releaser)",
      "amount": 500.00,
      "escrow_type": "single_release",
      "asset_code": "USDC"
    }
    """
    * def initStr = JSON.stringify(initBody)
    Given path '/api/escrows/initialize'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(initStr)
    And request initStr
    When method POST
    Then status 200

    # 2) Fund
    * def fundBody = { "contractId": "#(timingContractId)", "signer": "#(approver)", "amount": 500.00 }
    * def fundStr = JSON.stringify(fundBody)
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(fundStr)
    And request fundStr
    When method POST
    Then status 200

    # 3) Approve milestone (seed row — initialize does not create milestones)
    * def timingEscrowId = db.query("SELECT id FROM safetrust.trustless_work_escrows WHERE contract_id = '" + timingContractId + "'")[0].id
    * db.execute("INSERT INTO safetrust.escrow_milestones (escrow_id, milestone_id, description, amount, status, tenant_id) VALUES ('" + timingEscrowId + "', 'check_in', 'Timing milestone', 500.0, 'pending', 'safetrust') ON CONFLICT (escrow_id, milestone_id) DO NOTHING")
    * def approveBody =
    """
    {
      "contractId": "#(timingContractId)",
      "milestoneId": "check_in",
      "approver": "#(approver)",
      "flag": true
    }
    """
    * def approveStr = JSON.stringify(approveBody)
    Given path '/api/escrows/approve-milestone'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(approveStr)
    And request approveStr
    When method POST
    Then status 200

    # 4) Release
    * def releaseBody = { "contractId": "#(timingContractId)", "releaseSigner": "#(releaser)" }
    * def releaseStr = JSON.stringify(releaseBody)
    Given path '/api/escrows/release-funds'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(releaseStr)
    And request releaseStr
    When method POST
    Then status 200

    * def elapsed = Java.type('java.lang.System').currentTimeMillis() - start
    # O(4) Hasura-backed transitions: should complete < 10s under normal load
    And assert elapsed < 10000
    * def finalRows = db.query("SELECT status, (CASE WHEN balance = 0::numeric THEN '1' ELSE '0' END) AS balance_is_zero FROM safetrust.trustless_work_escrows WHERE contract_id = '" + timingContractId + "'")
    And match finalRows[0].status == 'completed'
    And match finalRows[0].balance_is_zero == '1'
    * db.execute("DELETE FROM safetrust.trustless_work_escrows WHERE contract_id = '" + timingContractId + "'")
    * def leftover = db.query("SELECT count(*)::text AS c FROM safetrust.trustless_work_escrows WHERE contract_id = '" + timingContractId + "'")
    And match leftover[0].c == '0'

  # ── Dispute branch: initialize → fund → dispute → resolve ─────────────────
  Scenario: Dispute branch — fund then dispute then resolve transitions correctly
    * db.execute("DELETE FROM safetrust.trustless_work_escrows WHERE contract_id = '" + disputeContractId + "'")
    # Initialize
    * def initBody =
    """
    {
      "contract_id": "#(disputeContractId)",
      "marker": "#(marker)",
      "approver": "#(approver)",
      "releaser": "#(releaser)",
      "resolver": "#(resolver)",
      "amount": 800.00,
      "escrow_type": "single_release",
      "asset_code": "USDC"
    }
    """
    * def initStr = JSON.stringify(initBody)
    Given path '/api/escrows/initialize'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(initStr)
    And request initStr
    When method POST
    Then status 200

    # Fund
    * def fundBody = { "contractId": "#(disputeContractId)", "signer": "#(approver)", "amount": 800.00 }
    * def fundStr = JSON.stringify(fundBody)
    Given path '/api/escrows/fund'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(fundStr)
    And request fundStr
    When method POST
    Then status 200

    # Dispute — status → disputed; balance must remain funded amount
    * def disputeBody = { "contractId": "#(disputeContractId)", "disputeFlag": true, "disputer": "#(approver)" }
    * def disputeStr = JSON.stringify(disputeBody)
    Given path '/api/escrows/dispute'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(disputeStr)
    And request disputeStr
    When method POST
    Then status 200
    * def disputed = db.query("SELECT status, balance FROM safetrust.trustless_work_escrows WHERE contract_id = '" + disputeContractId + "'")
    And match disputed[0].status == 'disputed'
    And match disputed[0].balance == '800.0000000'

    # Resolve from non-disputed must 404 — use a funded sibling to prove guard
    # (here: attempt resolve twice after success is covered below; first prove
    # resolve only matches status=disputed by resolving once then retrying).
    * def resolveBody = { "contractId": "#(disputeContractId)", "resolver": "#(resolver)", "resolutionNote": "Resolved" }
    * def resolveStr = JSON.stringify(resolveBody)
    Given path '/api/escrows/resolve-dispute'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(resolveStr)
    And request resolveStr
    When method POST
    Then status 200
    * def resolved = db.query("SELECT status, (CASE WHEN balance = 0::numeric THEN '1' ELSE '0' END) AS balance_is_zero FROM safetrust.trustless_work_escrows WHERE contract_id = '" + disputeContractId + "'")
    And match resolved[0].status == 'resolved'
    And match resolved[0].balance_is_zero == '1'

    # Status guard: resolve again must 404 (no longer disputed).
    # Clear idempotency so we exercise status=_eq disputed, not the 200 duplicate path.
    * db.execute("DELETE FROM safetrust.trustless_work_webhook_events WHERE contract_id = '" + disputeContractId + "' AND event_type = 'escrow.resolved'")
    Given path '/api/escrows/resolve-dispute'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(resolveStr)
    And request resolveStr
    When method POST
    Then status 404
    And match response.error contains 'Escrow not found'
