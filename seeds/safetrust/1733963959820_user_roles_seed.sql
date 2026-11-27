-- Keep both role sources aligned until the legacy users.role column is removed.
-- The demo owner has the host role; all other seeded demo users have guest.
INSERT INTO safetrust.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM safetrust.users u
JOIN safetrust.roles r
    ON r.name = CASE
        WHEN u.id = 'demo-owner-uid-002' THEN 'host'
        ELSE 'guest'
    END
WHERE u.id IN (
    'demo-tenant-uid-001',
    'demo-owner-uid-002',
    'demo-user-uid-003',
    'demo-user-uid-004',
    'demo-user-uid-005',
    'demo-user-uid-006',
    'demo-user-uid-007',
    'demo-user-uid-008'
)
ON CONFLICT (user_id, role_id) DO NOTHING;
