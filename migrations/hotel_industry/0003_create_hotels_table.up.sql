-- Migration: Create Hotels Table for Hotel Industry Tenant
-- Purpose: Establish database schema for hotel properties
-- Related Issues: 
--   - Implement Multi-Tenant Architecture (Database per Tenant) for SafeTrust #107
--   - Create public_users.yaml table for Hotel Industry Tenant #109

-- Ensure UUID extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create hotels table with comprehensive schema
CREATE TABLE IF NOT EXISTS hotels (
    -- Unique identifier for each hotel, using UUID v4 for global uniqueness
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Hotel name with length constraint
    name VARCHAR(20) NOT NULL,
    
    -- Optional description of the hotel
    description VARCHAR(50),
    
    -- Physical address of the hotel
    address VARCHAR(50) NOT NULL,
    
    -- Geographical area or location of the hotel
    location_area VARCHAR(20),
    
    -- Timestamp of record creation, defaults to current time
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Timestamp of last update, defaults to current time and auto-updates
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance optimization
-- Index on hotel name to speed up name-based queries
CREATE INDEX idx_hotels_name ON hotels(name);

-- Index on location area to improve location-based search performance
CREATE INDEX idx_hotels_location_area ON hotels(location_area);
