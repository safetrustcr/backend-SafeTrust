Feature: POST /api/escrows/approve-milestone — TrustlessWork milestone approval callback

  Background:
    * url baseUrl
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-users.sql'))
    * db.execute(karate.read('file:tests/karate/fixtures/seed-test-escrows.sql'))
    # Reset milestone state before each scenario
    * db.execute("UPDATE public.escrow_milestones SET status = 'pending', approved_by = NULL, approved_at = NULL WHERE milestone_id = 'check_in'")

  Scenario: Valid approval callback updates milestone to approved and escrow to milestone_approved
    Given path '/api/escrows/approve-milestone'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contractId": "escrow-funded-001",
      "milestoneId": "check_in",
      "approver": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "flag": true
    }
    """
    When method POST
    Then status 200
    And match response.received == true
    * def milestone = db.query("SELECT status, approved_by FROM public.escrow_milestones WHERE milestone_id = 'check_in'")
    And match milestone[0].status == 'approved'
    And match milestone[0].approved_by == 'GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z'
    * def escrow = db.query("SELECT status FROM public.trustless_work_escrows WHERE contract_id = 'escrow-funded-001'")
    And match escrow[0].status == 'milestone_approved'

  Scenario: Missing contractId returns 400
    Given path '/api/escrows/approve-milestone'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "milestoneId": "check_in",
      "approver": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "flag": true
    }
    """
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, milestoneId, approver, flag'

  Scenario: Missing milestoneId returns 400
    Given path '/api/escrows/approve-milestone'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contractId": "escrow-funded-001",
      "approver": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "flag": true
    }
    """
    When method POST
    Then status 400
    And match response.error == 'Missing required fields: contractId, milestoneId, approver, flag'

  Scenario: flag false returns 400
    Given path '/api/escrows/approve-milestone'
    And header Content-Type = 'application/json'
    And request
    """
    {
      "contractId": "escrow-funded-001",
      "milestoneId": "check_in",
      "approver": "GDQERENWDDSQZS7R7WQZKGESDRXL525W65XHIVZO4QPQCHRILIUQ2J7Z",
      "flag": false
    }
    """
    When method POST
    Then status 400
    And match response.error == 'flag must be true to approve a milestone'
