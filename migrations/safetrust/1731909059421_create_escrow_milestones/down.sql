-- Drop indexes
DROP INDEX IF EXISTS idx_milestones_escrow_id;
DROP INDEX IF EXISTS idx_milestones_status;
DROP INDEX IF EXISTS idx_milestones_due_date;
DROP INDEX IF EXISTS idx_milestones_milestone_id;
DROP INDEX IF EXISTS idx_milestones_tenant;

-- Drop table
DROP TABLE IF EXISTS public.escrow_milestones CASCADE;
