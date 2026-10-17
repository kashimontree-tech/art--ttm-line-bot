-- Schema snapshot. Applied through Supabase migrations on 18 October 2026.
create table if not exists public.ttm_ai_jobs (
 id uuid primary key default gen_random_uuid(),
 scope_id text not null check (scope_id <> 'unknown'),
 requester_id text not null,
 line_message_id text not null unique,
 kind text not null check (kind in ('document','image','audio','video','web')),
 payload jsonb not null default '{}'::jsonb,
 status text not null default 'queued' check (status in ('queued','running','completed','failed','needs_review')),
 result jsonb,
 error_detail text,
 delivery_attempts integer not null default 0,
 delivery_next_at timestamptz not null default now(),
 delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed')),
 created_at timestamptz not null default now(),
 started_at timestamptz,
 finished_at timestamptz
);
alter table public.ttm_ai_jobs enable row level security;
revoke all on public.ttm_ai_jobs from public, anon, authenticated;
grant select, insert, update on public.ttm_ai_jobs to service_role;
create index if not exists ttm_ai_jobs_queue_idx on public.ttm_ai_jobs (status,created_at);
create or replace function public.ttm_claim_ai_job() returns setof public.ttm_ai_jobs
 language sql security invoker set search_path = '' as $$
 update public.ttm_ai_jobs set status='running', started_at=now()
 where id=(select id from public.ttm_ai_jobs where status='queued' order by created_at
 for update skip locked limit 1) returning *;
 $$;
revoke all on function public.ttm_claim_ai_job() from public,anon,authenticated;
grant execute on function public.ttm_claim_ai_job() to service_role;
