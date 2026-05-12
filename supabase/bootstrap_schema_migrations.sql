-- One-time repair for Supabase projects where the migration history table is missing.
-- Run this in the Supabase SQL editor if the GitHub Integration reports:
-- relation "supabase_migrations.schema_migrations" does not exist

create schema if not exists supabase_migrations;

create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);

create table if not exists supabase_migrations.seed_files (
  path text primary key,
  hash text not null
);
