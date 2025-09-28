-- Test suite for enhanced pricing_overrides table
-- Author: ricaxvi

BEGIN;

-- Test 1: Should FAIL - all override values NULL
DO $$
BEGIN
    INSERT INTO safetrust.pricing_overrides 
    (base_rule_id, user_tier, effective_from, priority, is_active)
    VALUES (1, 'PREMIUM', NOW(), 1, true);
    
    RAISE EXCEPTION 'TEST FAILED: Should not allow all NULL override values';
EXCEPTION
    WHEN check_violation THEN
        RAISE NOTICE '✅ Test 1 PASSED: CHECK constraint works';
END $$;

-- Test 2: Should SUCCEED - valid override record
INSERT INTO safetrust.pricing_overrides 
(base_rule_id, user_tier, override_percentage, effective_from, priority, is_active)
VALUES (1, 'PREMIUM', 10.00, NOW(), 1, true);

-- Test 3: Check indexes were created
SELECT 
    schemaname,
    tablename,
    indexname
FROM pg_indexes 
WHERE schemaname = 'safetrust' 
    AND tablename = 'pricing_overrides'
    AND indexname LIKE 'idx_safetrust_pricing_overrides%';

ROLLBACK;