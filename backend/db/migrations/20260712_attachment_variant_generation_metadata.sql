alter table attachment_variants
  add column if not exists sha256 text,
  add column if not exists generation_version integer,
  add column if not exists updated_timestamp timestamptz not null default now();

alter table attachment_variants
  drop constraint if exists attachment_variants_sha256_chk,
  add constraint attachment_variants_sha256_chk
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  drop constraint if exists attachment_variants_generation_version_chk,
  add constraint attachment_variants_generation_version_chk
    check (generation_version is null or generation_version > 0);
