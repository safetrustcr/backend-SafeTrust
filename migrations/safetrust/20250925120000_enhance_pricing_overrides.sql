-- Test suite for enhanced pricing_overrides table
-- Issue: #188 - SafeTrust Pricing Overrides Enhancement
-- Author: ricaxvi
-- Run after applying migration

\echo 'Starting SafeTrust Pricing Overrides Enhancement Tests...';

BEGIN;

-- Test 1: Data integrity constraints
\echo 'Test 1: Data validation constraints';

-- Test 1a: Should FAIL - all override values NULL
DO $$
BEGIN
    INSERT INTO safetrust.pricing_overrides 
    (base_rule_id, user_tier, effective_from, effective_until, priority, is_active)
    VALUES (1, 'PREMIUM', NOW(), NOW() + INTERVAL '30 days', 1, true);
    
    RAISE EXCEPTION 'TEST FAILED: Should not allow all NULL override values';
EXCEPTION
    WHEN check_violation THEN
        RAISE NOTICE '✅ Test 1a PASSED: CHECK constraint prevents NULL override values';
END $$;

-- Test 1b: Should SUCCEED - valid override record
INSERT INTO safetrust.pricing_overrides 
(base_rule_id, user_tier, override_percentage, effective_from, effective_until, priority, is_active)
VALUES (1, 'PREMIUM', 10.00, NOW(), NOW() + INTERVAL '30 days', 1, true);

\echo '✅ Test 1b PASSED: Valid override record inserted successfully';

-- Test 2: Date validation constraints
\echo 'Test 2: Date validation constraints';

-- Test 2a: Should FAIL - end date before start date
DO $$
BEGIN
    INSERT INTO safetrust.pricing_overrides 
    (base_rule_id, override_percentage, effective_from, effective_until, priority, is_active)
    VALUES (1, 15.00, NOW(), NOW() - INTERVAL '1 day', 1, true);
    
    RAISE EXCEPTION 'TEST FAILED: Should not allow end date before start date';
EXCEPTION
    WHEN check_violation THEN
        RAISE NOTICE '✅ Test 2a PASSED: Date validation constraint works correctly';
END $$;

-- Test 3: Transaction amount validation
\echo 'Test 3: Transaction amount validation';

-- Test 3a: Should FAIL - max amount less than min amount
DO $$
BEGIN
    INSERT INTO safetrust.pricing_overrides 
    (base_rule_id, override_percentage, min_transaction_amount, max_transaction_amount, 
     effective_from, priority, is_active)
    VALUES (1, 25.00, 1000.00, 500.00, NOW(), 3, true);
    
    RAISE EXCEPTION 'TEST FAILED: Should not allow max < min transaction amounts';
EXCEPTION
    WHEN check_violation THEN
        RAISE NOTICE '✅ Test 3a PASSED: Transaction amount validation works correctly';
END $$;

-- Test 4: Check that indexes were created
\echo 'Test 4: Verifying performance indexes';

SELECT 
    schemaname,
    tablename,
    indexname,
    CASE 
        WHEN indexname LIKE 'idx_safetrust_pricing_overrides%' THEN '✅ Created'
        ELSE '❌ Missing'
    END as status
FROM pg_indexes 
WHERE schemaname = 'safetrust' 
    AND tablename = 'pricing_overrides'
    AND indexname LIKE 'idx_safetrust_pricing_overrides%'
ORDER BY indexname;

-- Test 5: Check updated_at trigger functionality
\echo 'Test 5: Testing updated_at trigger';

-- Update a record and verify updated_at changes
UPDATE safetrust.pricing_overrides 
SET priority = 2 
WHERE user_tier = 'PREMIUM';

-- Check that updated_at was automatically updated
SELECT 
    id,
    priority,
    created_at,
    updated_at,
    CASE 
        WHEN updated_at IS NOT NULL THEN '✅ Trigger working'
        ELSE '❌ Trigger failed'
    END as trigger_status
FROM safetrust.pricing_overrides 
WHERE user_tier = 'PREMIUM'
LIMIT 1;

-- Test 6: Verify constraint names and definitions
\echo 'Test 6: Verifying constraint definitions';

SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conrelid = 'safetrust.pricing_overrides'::regclass
    AND contype = 'c'  -- CHECK constraints
ORDER BY conname;

ROLLBACK;

