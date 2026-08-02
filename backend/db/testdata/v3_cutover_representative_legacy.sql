-- Representative rows for testing 20260802_zz_v3_database_table_cutover.sql.
-- Load only after the exact pre-cutover schema from the migration's parent commit.

insert into companies(company_id,name) values
('10000000-0000-0000-0000-000000000001','V3 migration fixture');

insert into users(user_id,cognito_subject,email,display_name) values
('20000000-0000-0000-0000-000000000001','fixture-owner','owner@example.com','Fixture Owner'),
('20000000-0000-0000-0000-000000000002','fixture-participant','participant@example.com','Fixture Participant');

insert into company_memberships(company_id,user_id,role) values
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','company_admin'),
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','company_user');

insert into user_email_connections(user_id,provider,account_email,grant_id,status) values
('20000000-0000-0000-0000-000000000001','google','owner@example.com','fixture-grant','connected');

insert into nodes(company_id,node_id,name,status,due_date,priority,default_access,created_timestamp) values
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Normalized email Node',null,null,null,'edit',now()),
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','Collaboration fallback Node',null,null,null,'edit',now()),
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','Projection fallback Node',null,null,null,'edit',now());

insert into node_textboxes(company_id,node_id,textbox_id,body_json,revision,display_order) values
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',
 '{"format":"mango-tiptap-json","schema_version":"1","document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"authoritative one"}]}]},"annotations":[]}'::jsonb,7,0),
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002',
 '{"format":"mango-tiptap-json","schema_version":"1","document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"authoritative two"}]}]},"annotations":[]}'::jsonb,3,0),
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000003',
 '{"format":"mango-tiptap-json","schema_version":"1","document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"authoritative three"}]}]},"annotations":[]}'::jsonb,2,0);

insert into node_projection_table(company_id,node_id,information_id,type,information,is_deleted,revision,created_timestamp,updated_timestamp) values
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Text box',
 '{"format":"mango-tiptap-json","schema_version":"1","document":{"type":"doc","content":[]},"annotations":[]}',false,5,now(),now()),
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','Text box',
 '{"format":"mango-tiptap-json","schema_version":"1","document":{"type":"doc","content":[]},"annotations":[]}',false,2,now(),now()),
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000003','Text box',
 '{"format":"mango-tiptap-json","schema_version":"1","document":{"type":"doc","content":[]},"annotations":[]}',false,1,now(),now()),
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','Text block chat',
 '{"block_id":"40000000-0000-0000-0000-000000000001","selection_source":"text","selection_quote":"selected","selection_start":0,"selection_end":8,"author_id":"20000000-0000-0000-0000-000000000001","author_name":"Fixture Owner","message":"current projection chat","entity_links":[],"mentioned_user_ids":["20000000-0000-0000-0000-000000000002"],"mentioned_group_ids":[]}',false,4,now(),now()),
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','Attached email',
 '{"message_id":"provider-message-1","thread_id":"provider-thread-1","email_thread_id":"50000000-0000-0000-0000-000000000001","subject":"fallback must not overwrite normalized","snippet":"stale duplicate"}',false,1,now(),now()),
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002','Attached email',
 '{"message_id":"provider-message-2","thread_id":"provider-thread-2","subject":"collaboration duplicate"}',false,1,now(),now()),
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000003','Attached email',
 '{"message_id":"provider-message-3","thread_id":"provider-thread-3","email_thread_id":"50000000-0000-0000-0000-000000000003","subject":"Projection fallback subject","snippet":"Projection fallback snippet","date":1700000300}',false,1,now(),now());

insert into node_information(company_id,information_id,node_id,type,information,save_kind,created_timestamp,updated_timestamp) values
('10000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Text block chat',
 '{"block_id":"40000000-0000-0000-0000-000000000001","message":"stale history chat"}','legacy',now()-interval '1 day',now()-interval '1 day');

insert into node_projection_seen_snapshots(company_id,node_id,information_id,user_id,information,projection_updated_timestamp,seen_timestamp) values
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','stale seen body',now()-interval '1 day',now());

insert into node_content_changes(company_id,change_id,node_id,information_id,change_type,text,start_offset,end_offset,actor_user_id,actor_display_name) values
('10000000-0000-0000-0000-000000000001','42000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','addition','authoritative',0,13,'20000000-0000-0000-0000-000000000001','Fixture Owner');

insert into communications_email_threads(
 company_id,email_thread_id,scope_type,personal_user_id,personal_account_email,
 account_email,provider_thread_key,provider_thread_id,root_provider_message_id,
 download_status,history_complete
) values
('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','personal','20000000-0000-0000-0000-000000000001','owner@example.com','owner@example.com','thread:provider-thread-1','provider-thread-1','provider-message-1','complete',true),
('10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003','personal','20000000-0000-0000-0000-000000000001','owner@example.com','owner@example.com','thread:provider-thread-3','provider-thread-3','provider-message-3','partial',false);

insert into communications_email_messages(
 company_id,email_message_id,email_thread_id,provider_message_id,provider_thread_id,
 message_order,subject,sender_snapshot,message_timestamp,rich_html_body,snippet,
 download_complete
) values
('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','provider-message-1','provider-thread-1',0,'Normalized subject','[{"name":"Sender","email":"sender@example.com"}]',1700000100,'<p>normalized body</p>','normalized snippet',true);

insert into communications_node_email_threads(
 company_id,node_id,information_id,email_thread_id,selected_provider_message_id,
 created_by_user_id
) values
('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','provider-message-1','20000000-0000-0000-0000-000000000001');

insert into communications_email_collaborations(
 company_id,collaboration_id,node_id,attached_email_information_id,scope_type,
 personal_user_id,personal_account_email,account_email,provider_thread_id,
 root_message_id,latest_message_id,message_snapshot,created_by_user_id,email_thread_id
) values
('10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002','personal',
 '20000000-0000-0000-0000-000000000001','owner@example.com','owner@example.com','provider-thread-2',
 'provider-message-2','provider-message-2',
 '{"id":"provider-message-2","thread_id":"provider-thread-2","subject":"Collaboration fallback subject","snippet":"Collaboration fallback snippet","body":"<p>fallback body</p>","date":1700000200,"from":[{"name":"Fallback Sender","email":"fallback@example.com"}],"to":[],"cc":[],"bcc":[],"reply_to":[],"attachments":[],"folders":[],"folder_ids":[],"unread":true,"starred":false,"download_complete":true}',
 '20000000-0000-0000-0000-000000000001',null);

insert into communications_email_collaboration_participants(
 company_id,collaboration_id,user_id,added_by_user_id,added_via_type,added_via_id
) values
('10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','user','20000000-0000-0000-0000-000000000002');

insert into attachments(
 attachment_id,company_id,uploaded_by_user_id,original_filename,mime_type,byte_size,
 sha256,storage_bucket,storage_key,source_kind,source_provider
) values
('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','fixture.txt','text/plain',1,
 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','fixture-bucket','fixture/key','email_incoming','google');

insert into resource_attachments(
 resource_attachment_id,company_id,resource_type,resource_id,attachment_id,
 information_id,message_id,relationship_kind,created_by_user_id
) values
('81000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','attached_email','30000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000001',
 '71000000-0000-0000-0000-000000000002','provider-message-2','email_attachment','20000000-0000-0000-0000-000000000001');