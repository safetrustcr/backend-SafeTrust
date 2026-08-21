-- Reverse: move all tables back to public
ALTER TABLE safetrust.users SET SCHEMA public;
ALTER TABLE safetrust.user_wallets SET SCHEMA public;
ALTER TABLE safetrust.roles SET SCHEMA public;
ALTER TABLE safetrust.user_roles SET SCHEMA public;
ALTER TABLE safetrust.trustless_work_escrows SET SCHEMA public;
ALTER TABLE safetrust.trustless_work_webhook_events SET SCHEMA public;
ALTER TABLE safetrust.escrow_milestones SET SCHEMA public;
ALTER TABLE safetrust.escrow_transactions SET SCHEMA public;
ALTER TABLE safetrust.apartments SET SCHEMA public;
ALTER TABLE safetrust.apartment_images SET SCHEMA public;
ALTER TABLE safetrust.reservations SET SCHEMA public;
ALTER TABLE safetrust.bid_requests SET SCHEMA public;
ALTER TABLE safetrust.pricing_rules SET SCHEMA public;
ALTER TABLE safetrust.pricing_overrides SET SCHEMA public;
ALTER TABLE safetrust.conversations SET SCHEMA public;
ALTER TABLE safetrust.messages SET SCHEMA public;

ALTER DATABASE postgres RESET search_path;
DROP SCHEMA IF EXISTS safetrust;
