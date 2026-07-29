begin;

alter type information_type add value if not exists 'Saved version';

commit;