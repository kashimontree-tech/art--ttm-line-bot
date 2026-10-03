create extension if not exists pgcrypto;

create table if not exists machines (
  id uuid primary key default gen_random_uuid(),
  machine_code text unique not null,
  name text not null,
  machine_type text not null default 'WASHER',
  capacity_kg int not null default 13,
  price_baht numeric(10,2) not null default 40,
  status text not null default 'READY',
  pulse_ms int not null default 400,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  payment_ref text unique not null,
  machine_code text not null,
  amount numeric(10,2) not null,
  status text not null default 'PENDING',
  provider text not null default 'mock',
  provider_txn_id text,
  paid_at timestamptz,
  command_sent boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists machine_commands (
  id uuid primary key default gen_random_uuid(),
  command_id uuid unique not null default gen_random_uuid(),
  machine_code text not null,
  payment_ref text,
  action text not null default 'START',
  pulse_ms int not null default 400,
  status text not null default 'QUEUED',
  sent_at timestamptz,
  ack_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists machine_logs (
  id bigserial primary key,
  machine_code text not null,
  event text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

insert into machines (machine_code, name, machine_type, capacity_kg, price_baht, status, pulse_ms)
values ('W13-01','เครื่องซัก 13 kg #1','WASHER',13,40,'READY',400)
on conflict (machine_code) do nothing;
