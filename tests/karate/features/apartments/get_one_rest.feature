Feature: GET /api/apartments/:id REST endpoint

Background:
# The REST API is served by the `webhook` service (http://webhook:3001).
* def apiBase = webhookUrl
# In NODE_ENV=test the auth middleware accepts 'mock-token' and reads the
# acting user from the x-test-uid header (see webhook/src/middleware/auth.js).
* def validToken = karate.call('classpath:helpers/get-firebase-token.js')

Scenario: returns 401 without token
Given url apiBase + '/api/apartments/00000000-0000-0000-0000-000000000000'
When method get
Then status 401
And match response == { error: 'Unauthorized', message: 'Missing or malformed Authorization header' }

Scenario: returns 404 when apartment does not exist
Given url apiBase + '/api/apartments/00000000-0000-0000-0000-000000000000'
And header Authorization = 'Bearer ' + validToken
And header x-test-uid = 'test-user'
When method get
Then status 404
And match response == { error: 'Apartment not found' }

# Optional: set APARTMENT_ID to a real UUID to assert 200 in CI/local
Scenario: returns 200 for existing apartment id (optional)
* def apartmentId = karate.properties['APARTMENT_ID'] || java.lang.System.getenv('APARTMENT_ID')
* if (!apartmentId) karate.log('Skipping 200 check; set APARTMENT_ID env var to a real UUID')
* if (!apartmentId) karate.abort()
Given url apiBase + '/api/apartments/' + apartmentId
And header Authorization = 'Bearer ' + validToken
And header x-test-uid = 'test-user'
When method get
Then status 200
And match response.apartment == { id: '#string', name: '#? _ != null', address: '#present', price_per_month: '#present', bedrooms: '#present', bathrooms: '#present', pet_friendly: '#present', description: '#present', is_promoted: '#present', owner: { name: '#present', email: '#present', walletAddress: '#present' } }
