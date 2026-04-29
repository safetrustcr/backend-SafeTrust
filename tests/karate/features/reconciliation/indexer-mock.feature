@ignore
Feature: TrustlessWork Indexer Mock Server
# ─────────────────────────────────────────────────────────────────────────────
# Karate mock server that stands in for the TrustlessWork indexer API.
# Started by docker-compose-test.yml on port 8082.
#
# Responds to:
#   GET /helper/get-escrows-by-contract-ids?contractIds=ID1,ID2,...
#
# Returns one synthetic escrow per requested contract_id so the reconciliation
# handler can upsert them without hitting the real network.
# ─────────────────────────────────────────────────────────────────────────────

Background:
  * def buildEscrows =
    """
    function(contractIds) {
      var ids = contractIds ? contractIds.split(',') : [];
      var escrows = [];
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i].trim();
        escrows.push({
          contractId: id,
          status: 'funded',
          amount: '100.0000000',
          balance: '50.0000000',
          escrowType: 'single_release',
          roles: {
            marker:   'MARKER_WALLET_ADDRESS',
            approver: 'APPROVER_WALLET_ADDRESS',
            releaser: 'RELEASER_WALLET_ADDRESS'
          }
        });
      }
      return { escrows: escrows };
    }
    """

Scenario: pathMatches('/helper/get-escrows-by-contract-ids') && methodIs('get')
  * def contractIds = paramValue('contractIds')
  * def responseBody = buildEscrows(contractIds)
  * def responseStatus = 200
  * def response = responseBody
