create table public.ttm_outbound_requests (
 id uuid primary key default gen_random_uuid(),
 scope_id text not null references public.ttm_group_registry(scope_id),
 kind text not null check (kind in ('text','file')),
 payload jsonb not null check (jsonb_typeof(payload)='object'),
 authorized_by text not null check (authorized_by='owner_explicit_chatgpt'),
 authorization_note text not null check (length(trim(authorization_note))>0),
 status text not null default 'pending' check (status in ('pending','sending','accepted','failed','cancelled')),
 result jsonb,
 error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '30 minutes'),
 check (scope_id ~ '^group:C[0-9a-fA-F]{32}$')
);
create index ttm_outbound_requests_pending_idx on public.ttm_outbound_requests(created_at) where status='pending';
alter table public.ttm_outbound_requests enable row level security;
revoke all on public.ttm_outbound_requests from public,anon,authenticated;
grant select,insert,update,delete on public.ttm_outbound_requests to service_role;
comment on table public.ttm_outbound_requests is 'Service-only explicit owner-authorized LINE outbound requests. No public or authenticated-user grants. API acceptance is not delivery.';
