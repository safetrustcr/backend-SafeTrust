Feature: GET /api/auth/me — role-based redirect behavior

  Background:
    * url webhookUrl
    * def hostUid   = 'host-user-001'
    * def guestUid  = 'guest-user-001'
    * def adminUid  = 'admin-user-001'
    * def hostToken  = karate.call('classpath:helpers/get-firebase-token.js', { uid: hostUid })
    * def guestToken = karate.call('classpath:helpers/get-firebase-token.js', { uid: guestUid })
    * def adminToken = karate.call('classpath:helpers/get-firebase-token.js', { uid: adminUid })

    # Clean and seed users
    * db.execute("DELETE FROM public.user_roles WHERE user_id IN ('host-user-001','guest-user-001','admin-user-001')")
    * db.execute("DELETE FROM public.users WHERE id IN ('host-user-001','guest-user-001','admin-user-001')")
    * db.execute("INSERT INTO public.users (id, firebase_uid, email) VALUES ('host-user-001',  'host-user-001',  'host@safetrust.cr')  ON CONFLICT DO NOTHING")
    * db.execute("INSERT INTO public.users (id, firebase_uid, email) VALUES ('guest-user-001', 'guest-user-001', 'guest@safetrust.cr') ON CONFLICT DO NOTHING")
    * db.execute("INSERT INTO public.users (id, firebase_uid, email) VALUES ('admin-user-001', 'admin-user-001', 'admin@safetrust.cr') ON CONFLICT DO NOTHING")

    # Assign roles
    * db.execute("INSERT INTO public.user_roles (user_id, role_id) SELECT 'host-user-001',  id FROM public.roles WHERE name = 'host'  ON CONFLICT DO NOTHING")
    * db.execute("INSERT INTO public.user_roles (user_id, role_id) SELECT 'guest-user-001', id FROM public.roles WHERE name = 'guest' ON CONFLICT DO NOTHING")
    * db.execute("INSERT INTO public.user_roles (user_id, role_id) SELECT 'admin-user-001', id FROM public.roles WHERE name = 'admin' ON CONFLICT DO NOTHING")

  # ── Host ──

  Scenario: Host user receives redirect to escrow-dashboard
    Given path '/api/auth/me'
    And header Authorization = 'Bearer ' + hostToken
    And header x-test-uid = hostUid
    When method GET
    Then status 200
    And match response.user.roles contains 'host'
    And match response.redirect == '/dashboard/escrow-dashboard'

  Scenario: Host role is stored correctly in user_roles table
    * def rows = db.query("SELECT r.name FROM public.roles r JOIN public.user_roles ur ON ur.role_id = r.id WHERE ur.user_id = 'host-user-001'")
    Then match rows[0].name == 'host'

  # ── Guest ─

  Scenario: Guest user receives redirect to guest dashboard
    Given path '/api/auth/me'
    And header Authorization = 'Bearer ' + guestToken
    And header x-test-uid = guestUid
    When method GET
    Then status 200
    And match response.user.roles contains 'guest'
    And match response.redirect == '/dashboard/guest'

  Scenario: Guest role is stored correctly in user_roles table
    * def rows = db.query("SELECT r.name FROM public.roles r JOIN public.user_roles ur ON ur.role_id = r.id WHERE ur.user_id = 'guest-user-001'")
    Then match rows[0].name == 'guest'

  # ── Admin ─

  Scenario: Admin user receives redirect to escrow-dashboard
    Given path '/api/auth/me'
    And header Authorization = 'Bearer ' + adminToken
    And header x-test-uid = adminUid
    When method GET
    Then status 200
    And match response.user.roles contains 'admin'
    And match response.redirect == '/dashboard/escrow-dashboard'

  Scenario: Admin role is stored correctly in user_roles table
    * def rows = db.query("SELECT r.name FROM public.roles r JOIN public.user_roles ur ON ur.role_id = r.id WHERE ur.user_id = 'admin-user-001'")
    Then match rows[0].name == 'admin'

  # ── No role ─

  Scenario: User with no role assigned defaults to guest redirect
    * def noRoleUid = 'no-role-user-001'
    * def noRoleToken = karate.call('classpath:helpers/get-firebase-token.js', { uid: noRoleUid })
    * db.execute("DELETE FROM public.users WHERE id = 'no-role-user-001'")
    * db.execute("INSERT INTO public.users (id, firebase_uid, email) VALUES ('no-role-user-001', 'no-role-user-001', 'norole@safetrust.cr') ON CONFLICT DO NOTHING")
    Given path '/api/auth/me'
    And header Authorization = 'Bearer ' + noRoleToken
    And header x-test-uid = noRoleUid
    When method GET
    Then status 200
    And match response.user.roles == []
    And match response.redirect == '/dashboard/guest'

  # ── Unauthenticated ─

  Scenario: No token returns 401
    Given path '/api/auth/me'
    When method GET
    Then status 401
    And match response.error == 'Unauthorized'
    And match response.message == 'Missing or malformed Authorization header'

  Scenario: Invalid token returns 401
    Given path '/api/auth/me'
    And header Authorization = 'Bearer invalid.token.here'
    When method GET
    Then status 401
    And match response.error == 'Unauthorized'
    And match response.message == 'Invalid or expired token'
