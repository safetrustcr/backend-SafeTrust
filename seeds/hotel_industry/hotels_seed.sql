-- hotels.sql
-- Seed data for the hotels table in hotel_industry
-- Purpose: Populate the hotels table with realistic, diverse hotel entries for development and testing.
-- Includes hotels from major Costa Rican cities and a few international locations, with accurate coordinates and varied location areas.

INSERT INTO hotels (name, description, address, location_area, coordinates) VALUES
('Hotel Central', 'Modern hotel in city center', 'Av. Central, San José', 'Central Valley', ST_SetSRID(ST_MakePoint(-84.0907, 9.9281), 4326)),
('EcoLodge Verde', 'Eco-friendly lodge in rainforest', 'Ruta 32, Limón', 'Caribbean', ST_SetSRID(ST_MakePoint(-83.0333, 10.0024), 4326)),
('Pacific Breeze', 'Beachfront hotel with ocean views', 'Playa Hermosa, Puntarenas', 'Pacific Coast', ST_SetSRID(ST_MakePoint(-84.8572, 9.6246), 4326)),
('Mountain Retreat', 'Quiet mountain escape', 'Cerro de la Muerte, Cartago', 'Highlands', ST_SetSRID(ST_MakePoint(-83.8071, 9.5667), 4326)),
('Urban Stay', 'Business hotel near airport', 'Alajuela Centro, Alajuela', 'Central Valley', ST_SetSRID(ST_MakePoint(-84.2088, 10.0163), 4326)),
('Tropical Paradise', 'Resort with tropical gardens', 'Playa Flamingo, Guanacaste', 'North Pacific', ST_SetSRID(ST_MakePoint(-85.7972, 10.4375), 4326)),
('Colonial Inn', 'Historic inn in old city', 'Calle 4, Cartago', 'Central Valley', ST_SetSRID(ST_MakePoint(-83.9214, 9.8644), 4326)),
('Jungle Hideaway', 'Secluded jungle cabins', 'Puerto Viejo, Limón', 'Caribbean', ST_SetSRID(ST_MakePoint(-83.2642, 9.6586), 4326)),
('Volcano View', 'Hotel with volcano views', 'La Fortuna, San Carlos', 'Northern Zone', ST_SetSRID(ST_MakePoint(-84.7036, 10.4717), 4326)),
('Sunset Suites', 'Luxury suites with sunset views', 'Playa Tamarindo, Guanacaste', 'North Pacific', ST_SetSRID(ST_MakePoint(-85.8419, 10.2993), 4326)),
('City Comfort', 'Affordable city hotel', 'Barrio Escalante, San José', 'Central Valley', ST_SetSRID(ST_MakePoint(-84.0625, 9.9366), 4326)),
('Rainforest Resort', 'All-inclusive rainforest resort', 'Sarapiquí, Heredia', 'Northern Zone', ST_SetSRID(ST_MakePoint(-84.1333, 10.4667), 4326)),
('Boutique Azul', 'Boutique hotel by the sea', 'Manuel Antonio, Puntarenas', 'Pacific Coast', ST_SetSRID(ST_MakePoint(-84.1589, 9.3895), 4326)),
('Urban Loft', 'Trendy loft in city', 'Sabana Norte, San José', 'Central Valley', ST_SetSRID(ST_MakePoint(-84.1012, 9.9427), 4326)),
('Global Plaza', 'International hotel chain', 'Av. Paulista, São Paulo', 'International', ST_SetSRID(ST_MakePoint(-46.6527, -23.5640), 4326));

-- End of hotels.sql
