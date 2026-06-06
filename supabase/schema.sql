-- Forja / Supabase schema
-- Run this in the Supabase SQL editor to create the tables used by the app.

create extension if not exists pgcrypto;

create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  nome text not null,
  email text not null unique,
  telefone text,
  status text not null default 'pendente' check (status in ('pendente', 'ativo')),
  plano text not null default 'vitalicio',
  mp_external_ref text unique,
  mp_payment_id text unique,
  ativado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists usuarios_status_idx on public.usuarios (status);
create index if not exists usuarios_mp_external_ref_idx on public.usuarios (mp_external_ref);
create index if not exists usuarios_mp_payment_id_idx on public.usuarios (mp_payment_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_usuarios_updated_at on public.usuarios;
create trigger set_usuarios_updated_at
before update on public.usuarios
for each row
execute function public.set_updated_at();

alter table public.usuarios enable row level security;
