alter table node_content_changes
  add column if not exists actor_display_name text;

update node_content_changes
   set actor_display_name=''
 where actor_display_name is null;

alter table node_content_changes
  alter column actor_display_name set default '',
  alter column actor_display_name set not null;
