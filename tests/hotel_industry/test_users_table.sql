-- Test user creation
DO $$
BEGIN
    -- Test 1: Create a valid user
    INSERT INTO public.users (email, first_name, last_name, phone_number)
    VALUES ('test@example.com', 'John', 'Doe', '+1234567890');
    
    -- Test 2: Attempt to create user with duplicate email (should fail)
    BEGIN
        INSERT INTO public.users (email, first_name, last_name)
        VALUES ('test@example.com', 'Jane', 'Smith');
        RAISE EXCEPTION 'Test failed: Duplicate email constraint not working';
    EXCEPTION
        WHEN unique_violation THEN
            RAISE NOTICE 'Test passed: Duplicate email constraint working as expected';
    END;
    
    -- Test 3: Create user with minimal required fields
    INSERT INTO public.users (email)
    VALUES ('minimal@example.com');
    
    -- Test 4: Verify updated_at trigger
    UPDATE public.users 
    SET first_name = 'Updated'
    WHERE email = 'test@example.com';
    
    IF NOT EXISTS (
        SELECT 1 
        FROM public.users 
        WHERE email = 'test@example.com' 
        AND updated_at > created_at
    ) THEN
        RAISE EXCEPTION 'Test failed: updated_at trigger not working';
    END IF;
    
    -- Test 5: Verify all fields can be updated
    UPDATE public.users 
    SET first_name = 'Johnny',
        last_name = 'Updated',
        phone_number = '+9876543210'
    WHERE email = 'test@example.com';
    
    -- Cleanup
    DELETE FROM public.users 
    WHERE email IN ('test@example.com', 'minimal@example.com');
    
    RAISE NOTICE 'All tests passed successfully';
END;
$$; 