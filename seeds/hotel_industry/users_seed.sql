CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO users (id, email, password_hash, first_name, last_name, phone_number)
VALUES 
( uuid_generate_v4(),'john.doe@example.com', '$2b$12$Omc.8qy3BNhoRCPyzCjhauWTDqWCz7N9MXhIS3KE5w4QtFYyyPhfK', 'John', 'Doe', '1234567890'),
( uuid_generate_v4(),'jane.smith@example.com', '$2b$12$3.KAi8DLrtXblaD0fIhkzu/wB7CjDM2dqnOtxhXYXEwCAQEFZDkmi', 'Jane', 'Smith', '0987654321'),
( uuid_generate_v4(),'alice.wonderland@example.com', '$2b$12$MVMusivSFubmH7vg3KgDZ.7jNqGi3tldLudKUnoxAa9svASfStiOy', 'Alice', 'Wonderland', '1122334455'),
( uuid_generate_v4(),'bob.builder@example.com', '$2b$12$dFqYsAKoN/xZKSCD5vNF7O6gjsb.97rOqJszJWnrO0ZX36T4yVbGu', 'Bob', 'Builder', '5566778899'),
( uuid_generate_v4(),'charlie.brown@example.com', '$2b$12$VUymbeLjTsekcym7hfjHZOWtizW2wOssDOVu5u24pSzh.HlFMuyUu', 'Charlie', 'Brown', '6677889900');