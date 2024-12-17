CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO bid_status_histories (id, bid_request_id, status, notes, changed_by, created_at)
VALUES
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 0),, 'Submitted', 'Bid request has been submitted.', (SELECT id FROM users WHERE username = 'user'), NOW()),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 1), 'Reviewed', 'Initial review completed by team lead.', (SELECT id FROM users WHERE username = 'team-lead'), NOW() - INTERVAL '1 day'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 2), 'Approved', 'Bid request approved by manager.', (SELECT id FROM users WHERE username = 'manager'), NOW() - INTERVAL '2 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 3), 'In_Progress', 'Work on the bid has commenced.', (SELECT id FROM users WHERE username = 'user'), NOW() - INTERVAL '3 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 4), 'Rejected', 'Bid request rejected due to insufficient budget.', (SELECT id FROM users WHERE username = 'finance'), NOW() - INTERVAL '4 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 5), 'Completed', 'All tasks related to the bid request have been completed.', (SELECT id FROM users WHERE username = 'admin'), NOW() - INTERVAL '5 days');