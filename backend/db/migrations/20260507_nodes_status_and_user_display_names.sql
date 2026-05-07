alter table users
  add column if not exists display_name text not null default '';

alter table nodes
  add column if not exists status text,
  add column if not exists status_color text;

