CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO bid_status_histories (id, bid_request_id, status, notes, changed_by, created_at)
VALUES
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 0), 'Submitted', 'Bid request has been submitted.', (SELECT id FROM users WHERE username = 'user'), NOW()),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 1), 'Reviewed', 'Initial review completed by team lead.', (SELECT id FROM users WHERE username = 'team-lead'), NOW() - INTERVAL '1 day'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 2), 'Approved', 'Bid request approved by manager.', (SELECT id FROM users WHERE username = 'manager'), NOW() - INTERVAL '2 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 3), 'In_Progress', 'Work on the bid has begun.', (SELECT id FROM users WHERE username = 'user'), NOW() - INTERVAL '3 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 4), 'Rejected', 'Bid request rejected due to insufficient budget.', (SELECT id FROM users WHERE username = 'finance'), NOW() - INTERVAL '4 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 5), 'Completed', 'All tasks related to the bid request have been completed.', (SELECT id FROM users WHERE username = 'admin'), NOW() - INTERVAL '5 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 6), 'Rejected', 'incorrect info.', (SELECT id FROM users WHERE username = 'admin'), NOW() - INTERVAL '5 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 7), 'Submitted', 'Bid request has been submitted.', (SELECT id FROM users WHERE username = 'user'), NOW() - INTERVAL '5 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 8), 'In_Progress', 'Awaiting approval.', (SELECT id FROM users WHERE username = 'user'), NOW() - INTERVAL '9 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 9), 'Approved', 'Reviewed and approved.', (SELECT id FROM users WHERE username = 'manager'), NOW() - INTERVAL '6 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 10), 'Rejected', 'Bid amount exceeded limit.', (SELECT id FROM users WHERE username = 'finance'), NOW() - INTERVAL '2 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 11), 'Aprroved', 'Bid has been finalized', (SELECT id FROM users WHERE username = 'admin'), NOW() - INTERVAL '6 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 12), 'Submitted', 'Initial status set.', (SELECT id FROM users WHERE username = 'user'), NOW() - INTERVAL '10 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 13), 'In_Progress', 'Work on the bid has begun.', (SELECT id FROM users WHERE username = 'user'), NOW() - INTERVAL '3 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 14), 'Rejected', 'Insufficient details provided.', (SELECT id FROM users WHERE username = 'finance'), NOW() - INTERVAL '4 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 15), 'Completed', 'All tasks related to the bid request have been completed.', (SELECT id FROM users WHERE username = 'admin'), NOW() - INTERVAL '5 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 16), 'Approved', 'Successfully met all requirements', (SELECT id FROM users WHERE username = 'admin'), NOW() - INTERVAL '5 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 17), 'Submitted', 'Bid request has been submitted.', (SELECT id FROM users WHERE username = 'user'), NOW() - INTERVAL '5 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 18), 'In_Progress', 'Waiting on additional documentation', (SELECT id FROM users WHERE username = 'user'), NOW() - INTERVAL '9 days'),
    (uuid_generate_v4(), (SELECT id FROM bid_requests LIMIT 1 OFFSET 19), 'Approved', 'Reviewed and approved.', (SELECT id FROM users WHERE username = 'manager'), NOW() - INTERVAL '6 days');