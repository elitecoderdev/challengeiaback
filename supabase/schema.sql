create table if not exists public.app_state (
  store_key text primary key,
  payload jsonb not null default '{"launches":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Optional: allow reads/writes with anon key by enabling RLS and policies.
-- Recommended for this backend: use SUPABASE_SERVICE_ROLE_KEY and keep RLS disabled
-- on this table, or create strict policies.
