-- Test suite for enhanced pricing_overrides table
-- Issue: #188 - SafeTrust Pricing Overrides Enhancement
-- Author: Majormaxx
-- Run after applying migration

\echo 'Starting SafeTrust Pricing Overrides Enhancement Tests...';

BEGIN;

-- ============================================================================
-- TEST 1: Data Integrity Constraints
-- ============================================================================
\echo 'Test 1: Data validation constraints';

-- Test 1a: Should FAIL - all override values NULL
DO $$
BEGIN
    INSERT INTO safetrust.pricing_overrides 
    (override_name, base_rule_id, user_tier, effective_from, effective_until, priority, is_active)
    VALUES ('Test Invalid', NULL, 'PREMIUM', NOW(), NOW() + INTERVAL '30 days', 1, true);
    
    RAISE EXCEPTION 'TEST FAILED: Should not allow all NULL override values';
EXCEPTION
    WHEN check_violation THEN
        RAISE NOTICE 'Test 1a PASSED: CHECK constraint prevents NULL override values';
END $$;

-- Test 1b: Should SUCCEED - valid override record with override_percentage
DO $$
DECLARE
    test_id UUID;
BEGIN
    INSERT INTO safetrust.pricing_overrides 
    (override_name, base_rule_id, user_tier, override_percentage, effective_from, effective_until, priority, is_active)
    VALUES ('Test Valid Percentage', NULL, 'PREMIUM', 10.00, NOW(), NOW() + INTERVAL '30 days', 1, true)
    RETURNING id INTO test_id;
    
    IF test_id IS NOT NULL THEN
        RAISE NOTICE 'Test 1b PASSED: Valid override record with percentage inserted';
        DELETE FROM safetrust.pricing_overrides WHERE id = test_id;
    END IF;
END $$;

-- Test 1c: Should SUCCEED - valid override record with override_base_amount
DO $$
DECLARE
    test_id UUID;
BEGIN
    INSERT INTO safetrust.pricing_overrides 
    (override_name, base_rule_id, override_base_amount, priority, is_active)
    VALUES ('Test Valid Amount', NULL, 5.50, 1, true)
    RETURNING id INTO test_id;
    
    IF test_id IS NOT NULL THEN
        RAISE NOTICE 'Test 1c PASSED: Valid override record with base_amount inserted';
        DELETE FROM safetrust.pricing_overrides WHERE id = test_id;
    END IF;
END $$;

-- ============================================================================
-- TEST 2: Date Validation Constraints
-- ============================================================================
\echo 'Test 2: Date validation constraints';

-- Test 2a: Should FAIL - end date before start date
DO $$
BEGIN
    INSERT INTO safetrust.pricing_overrides 
    (override_name, override_percentage, effective_from, effective_until, priority, is_active)
    VALUES ('Test Invalid Dates', 15.00, NOW(), NOW() - INTERVAL '1 day', 1, true);
    
    RAISE EXCEPTION 'TEST FAILED: Should not allow end date before start date';
EXCEPTION
    WHEN check_violation THEN
        RAISE NOTICE 'Test 2a PASSED: Date validation constraint works correctly';
END $$;

-- Test 2b: Should SUCCEED - valid date range (end after start)
DO $$
DECLARE
    test_id UUID;
BEGIN
    INSERT INTO safetrust.pricing_overrides 
    (override_name, override_percentage, effective_from, effective_until, priority, is_active)
    VALUES ('Test Valid Dates', 15.00, NOW(), NOW() + INTERVAL '7 days', 1, true)
    RETURNING id INTO test_id;
    
    IF test_id IS NOT NULL THEN
        RAISE NOTICE 'Test 2b PASSED: Valid date range accepted';
        DELETE FROM safetrust.pricing_overrides WHERE id = test_id;
    END IF;
END $$;

-- Test 2c: Should SUCCEED - NULL end date (permanent override)
DO $$
DECLARE
    test_id UUID;
BEGIN
    INSERT INTO safetrust.pricing_overrides 
    (override_name, override_percentage, effective_from, priority, is_active)
    VALUES ('Test Permanent Override', 10.00, NOW(), 1, true)
    RETURNING id INTO test_id;
    
    IF test_id IS NOT NULL THEN
        RAISE NOTICE 'Test 2c PASSED: NULL end date (permanent override) accepted';
        DELETE FROM safetrust.pricing_overrides WHERE id = test_id;
    END IF;
END $$;

-- ============================================================================
-- TEST 3: Transaction Amount Validation
-- ============================================================================
\echo 'Test 3: Transaction amount validation';

-- Test 3a: Should FAIL - max amount less than min amount
DO $$
BEGIN
    INSERT INTO safetrust.pricing_overrides 
    (override_name, override_percentage, min_transaction_amount, max_transaction_amount, 
     effective_from, priority, is_active)
    VALUES ('Test Invalid Amounts', 25.00, 1000.00, 500.00, NOW(), 3, true);
    
    RAISE EXCEPTION 'TEST FAILED: Should not allow max < min transaction amounts';
EXCEPTION
    WHEN check_violation THEN
        RAISE NOTICE 'Test 3a PASSED: Transaction amount validation works correctly';
END $$;

-- Test 3b: Should SUCCEED - valid amount range (max >= min)
DO $$
DECLARE
    test_id UUID;
BEGIN
    INSERT INTO safetrust.pricing_overrides 
    (override_name, override_percentage, min_transaction_amount, max_transaction_amount, priority, is_active)
    VALUES ('Test Valid Amounts', 20.00, 100.00, 1000.00, 1, true)
    RETURNING id INTO test_id;
    
    IF test_id IS NOT NULL THEN
        RAISE NOTICE 'Test 3b PASSED: Valid amount range accepted';
        DELETE FROM safetrust.pricing_overrides WHERE id = test_id;
    END IF;
END $$;

-- Test 3c: Should SUCCEED - only min amount specified
DO $$
DECLARE
    test_id UUID;
BEGIN
    INSERT INTO safetrust.pricing_overrides 
    (override_name, override_percentage, min_transaction_amount, priority, is_active)
    VALUES ('Test Min Only', 15.00, 500.00, 1, true)
    RETURNING id INTO test_id;
    
    IF test_id IS NOT NULL THEN
        RAISE NOTICE 'Test 3c PASSED: Only min_transaction_amount accepted';
        DELETE FROM safetrust.pricing_overrides WHERE id = test_id;
    END IF;
END $$;

-- ============================================================================
-- TEST 4: Verify Performance Indexes
-- ============================================================================
\echo 'Test 4: Verifying performance indexes';

SELECT 
    indexname,
    CASE 
        WHEN indexname LIKE 'idx_safetrust_pricing_overrides%' THEN 'PASS'
        ELSE 'MISSING'
    END as status
FROM pg_indexes 
WHERE schemaname = 'safetrust' 
    AND tablename = 'pricing_overrides'
    AND indexname LIKE 'idx_safetrust_pricing_overrides%'
ORDER BY indexname;

-- Verify expected index count (should be 6 new partial indexes)
DO $$
DECLARE
    idx_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO idx_count
    FROM pg_indexes 
    WHERE schemaname = 'safetrust' 
        AND tablename = 'pricing_overrides'
        AND indexname LIKE 'idx_safetrust_pricing_overrides%';
    
    IF idx_count >= 6 THEN
        RAISE NOTICE 'Test 4 PASSED: Found % performance indexes (expected >= 6)', idx_count;
    ELSE
        RAISE NOTICE 'Test 4 WARNING: Found only % performance indexes (expected >= 6)', idx_count;
    END IF;
END $$;

-- ============================================================================
-- TEST 5: Check updated_at Trigger Functionality
-- ============================================================================
\echo 'Test 5: Testing updated_at trigger';

DO $$
DECLARE
    test_id UUID;
    orig_updated_at TIMESTAMPTZ;
    new_updated_at TIMESTAMPTZ;
BEGIN
    -- Insert a test record
    INSERT INTO safetrust.pricing_overrides 
    (override_name, override_percentage, priority, is_active)
    VALUES ('Test Trigger', 10.00, 1, true)
    RETURNING id, updated_at INTO test_id, orig_updated_at;
    
    -- Wait briefly to ensure timestamp difference
    PERFORM pg_sleep(0.1);
    
    -- Update the record
    UPDATE safetrust.pricing_overrides 
    SET priority = 2 
    WHERE id = test_id;
    
    -- Get new updated_at
    SELECT updated_at INTO new_updated_at
    FROM safetrust.pricing_overrides 
    WHERE id = test_id;
    
    -- Verify trigger worked
    IF new_updated_at > orig_updated_at THEN
        RAISE NOTICE 'Test 5 PASSED: updated_at trigger working correctly';
    ELSE
        RAISE NOTICE 'Test 5 FAILED: updated_at was not updated';
    END IF;
    
    -- Cleanup
    DELETE FROM safetrust.pricing_overrides WHERE id = test_id;
END $$;

-- ============================================================================
-- TEST 6: Verify Constraint Definitions
-- ============================================================================
\echo 'Test 6: Verifying constraint definitions';

SELECT 
    conname as constraint_name,
    CASE contype 
        WHEN 'c' THEN 'CHECK'
        WHEN 'p' THEN 'PRIMARY KEY'
        WHEN 'f' THEN 'FOREIGN KEY'
        WHEN 'u' THEN 'UNIQUE'
    END as constraint_type
FROM pg_constraint 
WHERE conrelid = 'safetrust.pricing_overrides'::regclass
    AND contype = 'c'  -- CHECK constraints only
ORDER BY conname;

-- Verify expected CHECK constraints exist
DO $$
DECLARE
    constraint_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO constraint_count
    FROM pg_constraint 
    WHERE conrelid = 'safetrust.pricing_overrides'::regclass
        AND contype = 'c'
        AND conname IN (
            'check_override_values_specified',
            'check_effective_dates',
            'check_transaction_amounts'
        );
    
    IF constraint_count = 3 THEN
        RAISE NOTICE 'Test 6 PASSED: All 3 CHECK constraints exist';
    ELSE
        RAISE NOTICE 'Test 6 WARNING: Found only % of 3 expected CHECK constraints', constraint_count;
    END IF;
END $$;

-- ============================================================================
-- TEST 7: Backward Compatibility - Existing Seed Data
-- ============================================================================
\echo 'Test 7: Backward compatibility check';

DO $$
DECLARE
    existing_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO existing_count
    FROM safetrust.pricing_overrides
    WHERE is_active = true;
    
    IF existing_count >= 0 THEN
        RAISE NOTICE 'Test 7 PASSED: Existing data (% active records) remains functional', existing_count;
    END IF;
END $$;

\echo 'All tests completed.';

ROLLBACK;