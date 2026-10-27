# Safetrust permissions

Safetrust JWTs use the `guest`, `host`, and `admin` roles. Authenticated
`guest` and `host` requests are scoped by `X-Hasura-User-Id`; there is no
`anonymous`, `user`, `tenant`, or `landlord` role in this tenant's metadata.

## Guest

| Table | Select | Insert | Update |
| --- | --- | --- | --- |
| `users` | Own row: `id`, `email`, `first_name`, `last_name`, `phone_number`, `country_code`, `location`, `role`, `last_seen` | — | Own row only: `first_name`, `last_name`, `phone_number`, `country_code`, `location` |
| `apartments` | Available, non-deleted listings: `id`, `name`, `description`, `price`, `warranty_deposit`, `address`, `coordinates`, `bedrooms`, `bathrooms`, `capacity`, `max_guests`, `floor_area`, `furnished`, `pet_friendly`, `category`, `is_available`, `available_from`, `available_until`, `owner_id` | — | — |
| `apartment_images` | `id`, `apartment_id`, `image_url`, `uploaded_at` for available, non-deleted apartments | — | — |
| `user_wallets` | Own `id`, `user_id`, `wallet_address`, `chain_type`, `is_primary`, `created_at`, `updated_at` | — | — |
| `bid_requests` | Own `id`, `apartment_id`, `tenant_id`, `current_status`, `proposed_price`, `desired_move_in`, `created_at`, `updated_at` | `apartment_id`, `proposed_price`, `desired_move_in`; `tenant_id` is forced to the authenticated guest | Own pending/viewed offer: `proposed_price`, `desired_move_in` |
| `bid_status_histories` | Own-offer `id`, `bid_request_id`, `status`, `notes`, `changed_by`, `created_at` | — | — |
| `reservations` | Own `id`, `apartment_id`, `guest_id`, `escrow_id`, `check_in_date`, `check_out_date`, `total_amount`, `asset_code`, `status`, `created_at`, `updated_at` | — | — |
| `roles` | Role `id` and `name` | — | — |
| `user_roles` | Own role assignments: `user_id`, `role_id`, `created_at` | — | — |
| `pricing_rules` | Active `id`, `rule_name`, `rule_type`, `token`, `base_amount`, `percentage`, `min_amount`, `max_amount`, `priority`, `is_active`, `created_at` | — | — |
| `pricing_overrides` | Active `id`, `override_name`, `base_rule_id`, `override_percentage`, `override_base_amount`, `effective_from`, `effective_until`, `priority`, `is_active`, `user_tier`, `created_at` | — | — |

## Host

| Table | Select | Insert | Update |
| --- | --- | --- | --- |
| `users` | Own row: `id`, `email`, `first_name`, `last_name`, `phone_number`, `country_code`, `location`, `role`, `last_seen` | — | Own row only: `first_name`, `last_name`, `phone_number`, `country_code`, `location` |
| `apartments` | Own listings and available, non-deleted listings: `id`, `name`, `description`, `price`, `warranty_deposit`, `address`, `coordinates`, `bedrooms`, `bathrooms`, `capacity`, `max_guests`, `floor_area`, `furnished`, `pet_friendly`, `category`, `is_available`, `available_from`, `available_until`, `owner_id`, `created_at`, `updated_at`, `deleted_at` | Create a listing with `owner_id` forced to the authenticated host; all listing fields except `owner_id` and timestamps | Own non-deleted listing fields, including `deleted_at` for soft deletion; `owner_id` is immutable |
| `apartment_images` | `id`, `apartment_id`, `image_url`, `uploaded_at` for own apartments and available listings | `apartment_id`, `image_url` for own apartments | `image_url` for own apartments |
| `user_wallets` | Own `id`, `user_id`, `wallet_address`, `chain_type`, `is_primary`, `created_at`, `updated_at` | — | — |
| `bid_requests` | Offers for own apartments: `id`, `apartment_id`, `tenant_id`, `current_status`, `proposed_price`, `desired_move_in`, `created_at`, `updated_at` | — | `current_status` for offers on own apartments |
| `bid_status_histories` | History for offers on own apartments: `id`, `bid_request_id`, `status`, `notes`, `changed_by`, `created_at` | — | — |
| `reservations` | Own-apartment `id`, `apartment_id`, `guest_id`, `escrow_id`, `check_in_date`, `check_out_date`, `total_amount`, `asset_code`, `status`, `created_at`, `updated_at` | — | — |
| `roles` | Role `id` and `name` | — | — |
| `user_roles` | Own role assignments: `user_id`, `role_id`, `created_at` | — | — |
| `pricing_rules` | Active `id`, `rule_name`, `rule_type`, `token`, `base_amount`, `percentage`, `min_amount`, `max_amount`, `priority`, `is_active`, `created_at` | — | — |
| `pricing_overrides` | Active `id`, `override_name`, `base_rule_id`, `override_percentage`, `override_base_amount`, `effective_from`, `effective_until`, `priority`, `is_active`, `user_tier`, `created_at` | — | — |

## Admin

| Table or action | Select | Insert | Update |
| --- | --- | --- | --- |
| `users` | All columns and rows | — | — |
| `apartments` | All columns and rows | — | — |
| `bid_requests` | All columns and rows | `apartment_id`, `tenant_id`, `proposed_price`, `desired_move_in`, `current_status` | `current_status` |
| `bid_status_histories` | History for offers attached to apartments | Record offer status history | — |
| `reservations` | `id`, `apartment_id`, `guest_id`, `escrow_id`, `check_in_date`, `check_out_date`, `total_amount`, `asset_code`, `status`, `created_at`, `updated_at` for all rows | — | — |
| `apartment_images` | All columns for images attached to apartments with a non-empty owner | `apartment_id`, `image_url` for apartments with a non-empty owner | `image_url` for images attached to apartments with a non-empty owner |
| `roles` | All columns and rows | — | — |
| `user_roles` | `user_id`, `role_id`, `created_at` for all users | Assign roles | — |
| `pricing_rules` | All columns and rows | Create pricing rules | Update pricing rules |
| `pricing_overrides` | All columns and rows | Create overrides | Update overrides |

Admins can invoke `trigger_fund_release` and `process_refund_request`. Guests
and hosts can invoke `process_refund_request`.
Admins can also delete user-role assignments.

Stellar wallet creation and unlinking are handled by the verified wallet
challenge flow and IC-09 endpoints, not direct Hasura wallet writes. Apartment
deletion is a soft delete through `deleted_at`, preserving offer and reservation
foreign-key targets. Profile values are additionally constrained in PostgreSQL:
names are 1–100 trimmed characters, phone numbers 7–32 trimmed characters,
country codes match `+` followed by 1–4 digits, and locations are 1–255 trimmed
characters. These fields may be `NULL`.

Conversations, messages, and escrow transactions are not included in Safetrust
Hasura metadata until their role-scoped permissions are defined.
