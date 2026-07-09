-- Seed test users
DELETE FROM public.users WHERE id IN ('owner-123', 'tenant-456', 'other-user', 'host-user-001', 'guest-user-001', 'admin-user-001');

INSERT INTO public.users (id, email, last_seen, firebase_uid) VALUES
('owner-123', 'owner@example.com', NOW(), 'owner-123'),
('tenant-456', 'tenant@example.com', NOW(), 'tenant-456'),
('other-user', 'other@example.com', NOW(), 'other-user'),
('host-user-001', 'host@safetrust.cr', NOW(), 'host-user-001'),
('guest-user-001', 'guest@safetrust.cr', NOW(), 'guest-user-001'),
('admin-user-001', 'admin@safetrust.cr', NOW(), 'admin-user-001');
