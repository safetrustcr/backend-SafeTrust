# SafeTrust schema normalization (issue #790)

Migration `1793400000000_normalize_duplicated_facts` gives each fact one home.

| Before | After |
| --- | --- |
| `users.role` and `user_roles` | `user_roles` only (a user can hold several roles). Existing `users.role` values are copied into `user_roles` before the column is dropped. |
| `apartments.capacity` and `apartments.max_guests` | `max_guests` only (larger of the two is kept). |
| `pricing_overrides.user_id_list` (text[]) | `pricing_override_users (override_id, user_id)`. Ids not present in `users` are dropped, duplicates collapse. |
| `bid_requests.tenant_id` (held the bidder's user id) | `bid_requests.bidder_id`. One active bid per bidder is still enforced. |

`users.id` and `users.firebase_uid` are intentionally untouched. Seeds and handlers that insert users must not set `role`.
The down migration restores the columns; a restored `users.role` holds only the highest role.
