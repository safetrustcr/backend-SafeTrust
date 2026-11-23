-- SafeTrust demo user roles seed
-- Ordered after 1733963959819_user_seed.sql so demo users exist before role assignment
-- Both safetrust.users.role and safetrust.user_roles must be set until issue #26 removes users.role

INSERT INTO safetrust.user_roles (user_id, role_id)
SELECT
    v.user_id,
    r.id
FROM (
    VALUES
        ('demo-tenant-uid-001', 'guest'),
        ('demo-owner-uid-002',  'host'),
        ('demo-user-uid-003',   'guest'),
        ('demo-user-uid-004',   'guest'),
        ('demo-user-uid-005',   'guest'),
        ('demo-user-uid-006',   'guest'),
        ('demo-user-uid-007',   'guest'),
        ('demo-user-uid-008',   'guest')
) AS v(user_id, role_name)
JOIN safetrust.roles r ON r.name = v.role_name
ON CONFLICT (user_id, role_id) DO NOTHING;
