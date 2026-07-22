Feature: POST /api/escrows/approve-milestone — TrustlessWork milestone approval callback

  Background:
    * url webhookUrl
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))
    # Reset milestone state before each scenario
    * db.execute("UPDATE public.escrow_milestones SET status = 'pending', approved_by = NULL, approved_at = NULL WHERE milestone_id = 'check_in'")

  Scenario: Valid approval callback updates milestone to approved and escrow to milestone_approved
    * def body = { "contractId": "escrow-funded-001", "milestoneId": "check_in", "approver": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "flag": true }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/approve-milestone'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 200
    And match response.received == true
    * def milestone = db.query("SELECT status, approved_by FROM public.escrow_milestones WHERE milestone_id = 'check_in'")
    And match milestone[0].status == 'approved'
    And match milestone[0].approved_by == 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z'
    * def escrow = db.query("SELECT status FROM public.trustless_work_escrows WHERE contract_id = 'escrow-funded-001'")
    And match escrow[0].status == 'milestone_approved'

  Scenario: Missing contractId returns 400
    * def body = { "milestoneId": "check_in", "approver": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "flag": true }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/approve-milestone'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, milestoneId, approver, flag'

  Scenario: Missing milestoneId returns 400
    * def body = { "contractId": "escrow-funded-001", "approver": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "flag": true }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/approve-milestone'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, milestoneId, approver, flag'

  Scenario: flag false returns 400
    * def body = { "contractId": "escrow-funded-001", "milestoneId": "check_in", "approver": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "flag": false }
    * def bodyStr = JSON.stringify(body)
    Given path '/api/escrows/approve-milestone'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = trustlessWorkSignature(bodyStr)
    And request bodyStr
    When method POST
    Then status 400
    And match response.error == 'flag must be true to approve a milestone'

  Scenario: Missing signature header returns 401
    * def body = { "contractId": "escrow-funded-001", "milestoneId": "check_in", "approver": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "flag": true }
    Given path '/api/escrows/approve-milestone'
    And header Content-Type = 'application/json'
    And request body
    When method POST
    Then status 401
    And match response.error == 'Missing x-trustlesswork-signature header'

  Scenario: Incorrect signature returns 401
    * def body = { "contractId": "escrow-funded-001", "milestoneId": "check_in", "approver": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z", "flag": true }
    Given path '/api/escrows/approve-milestone'
    And header Content-Type = 'application/json'
    And header x-trustlesswork-signature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
    And request body
    When method POST
    Then status 401
    And match response.error == 'Invalid webhook signature'
