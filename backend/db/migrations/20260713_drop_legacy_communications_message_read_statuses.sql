-- Read receipts now use communications_message_read_receipt_summaries with an
-- exact personal-account or shared-inbox scope. The former user-wide personal
-- table was migrated by 20260630_communications_message_read_receipt_summaries.sql
-- and must not remain as a shadow write/read path.
drop table if exists communications_message_read_statuses;
