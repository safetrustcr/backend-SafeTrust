Feature: GET /api/apartments/:id REST endpoint

Background:
* def apiBase = 'http://api:3001'
* def authHeader = restToken({ sub: 'test-user' })

Scenario: returns 401 without token
Given url apiBase + '/api/apartments/00000000-0000-0000-0000-000000000000'
When method get
Then status 401
And match response == { error: 'Unauthorized' }
And match responseHeaders.'WWW-Authenticate' == 'Bearer'

Scenario: returns 404 when apartment does not exist
Given url apiBase + '/api/apartments/00000000-0000-0000-0000-000000000000'
And header Authorization = authHeader
When method get
Then status 404
And match response == { error: 'Apartment not found' }

# Optional: set APARTMENT_ID to a real UUID to assert 200 in CI/local
Scenario: returns 200 for existing apartment id (optional)
* def apartmentId = karate.properties['APARTMENT_ID'] || java.lang.System.getenv('APARTMENT_ID')
* if (!apartmentId) karate.log('Skipping 200 check; set APARTMENT_ID env var to a real UUID')
* if (!apartmentId) karate.abort()
Given url apiBase + '/api/apartments/' + apartmentId
And header Authorization = authHeader
When method get
Then status 200
And match response.apartment == { id: '#string', name: '#? _ != null', address: '#present', price_per_month: '#present', bedrooms: '#present', bathrooms: '#present', pet_friendly: '#present', description: '#present', is_promoted: '#present', owner: { name: '#present', email: '#present', walletAddress: '#present' } }
