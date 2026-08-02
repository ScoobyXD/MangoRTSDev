import { createHash } from "node:crypto";

import pg from "pg";

import {
  convertMangoLegacyHTML,
  type MangoLegacyAttachmentMetadata,
} from "./mango-html-to-json-core.js";
import {
  assertV3NodeTextboxBackfillSafety,
  legacyNodeTextboxHTML,
  mangoAttachmentIDs,
  parseV3NodeTextboxBackfillArguments,
  v3NodeTextboxBody,
  type V3NodeTextboxBackfillArguments,
} from "./v3-node-textbox-backfill-core.js";

const { Pool } = pg;

type SourceRow = {
  company_id: string;
  node_id: string;
  textbox_id: string;
  revision: string;
  is_deleted: boolean;
  source_information: string;
  created_timestamp: string;
  updated_timestamp: string;
  display_order: string;
  attachment_metadata: Array<Record<string, unknown>>;
};

type ConvertedRow = SourceRow & {
  body: Record<string, unknown>;
  report: Record<string, unknown>;
};

const SOURCE_COLUMNS = [
  "company_id", "node_id", "information_id", "type", "information", "is_deleted",
  "revision", "created_timestamp", "updated_timestamp",
].sort();
const TARGET_COLUMNS = [
  "company_id", "node_id", "textbox_id", "body_json", "revision", "display_order",
  "created_timestamp", "updated_timestamp", "deleted_timestamp",
].sort();

function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJSON(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeAttachmentMetadata(rows: Array<Record<string, unknown>>): MangoLegacyAttachmentMetadata[] {
  return rows.map((row) => {
    const byteSize = Number(row.byteSize);
    if (!Number.isSafeInteger(byteSize) || byteSize < 0) throw new Error("attachment_byte_size_is_invalid");
    const attachmentId = String(row.attachmentId ?? "").trim().toLowerCase();
    const filename = String(row.filename ?? "");
    const mimeType = String(row.mimeType ?? "");
    const digest = String(row.sha256 ?? "").trim().toLowerCase();
    if (!attachmentId || !filename || !mimeType || !digest) throw new Error("attachment_metadata_is_incomplete");
    const width = row.width === null || row.width === undefined ? null : Number(row.width);
    const height = row.height === null || row.height === undefined ? null : Number(row.height);
    return {
      attachmentId,
      sourceResourceAttachmentId: String(row.sourceResourceAttachmentId ?? "") || undefined,
      filename,
      mimeType,
      byteSize,
      sha256: digest,
      width,
      height,
      relationshipKind: String(row.relationshipKind ?? "") || undefined,
    };
  });
}

async function assertExactColumns(client: pg.PoolClient, table: string, expected: readonly string[]): Promise<void> {
  const result = await client.query<{ column_name: string }>(
    `select column_name::text
       from information_schema.columns
      where table_schema='public' and table_name=$1
      order by ordinal_position`,
    [table],
  );
  const actual = result.rows.map((row) => row.column_name).sort();
  if (stableJSON(actual) !== stableJSON(expected)) {
    throw new Error(`v3_node_textbox_backfill_schema_drift:${table}:expected=${expected.join(",")}:found=${actual.join(",")}`);
  }
}

async function assertSchema(client: pg.PoolClient): Promise<void> {
  await assertExactColumns(client, "node_projection_table", SOURCE_COLUMNS);
  await assertExactColumns(client, "node_textboxes", TARGET_COLUMNS);
}

async function inventory(client: pg.PoolClient, companyID: string): Promise<Record<string, unknown>> {
  const result = await client.query(
    `with missing as (
       select projection.*
         from node_projection_table projection
        where projection.company_id=$1::uuid
          and not projection.is_deleted
          and projection.type='Text box'::information_type
          and not exists (
            select 1 from node_textboxes textbox
             where textbox.company_id=projection.company_id
               and textbox.node_id=projection.node_id
               and textbox.textbox_id=projection.information_id
          )
     )
     select count(*)::integer as missing_rows,
            count(distinct node_id)::integer as affected_nodes,
            count(*) filter(where information like '<!-- mango-node-text-block-v1 -->%')::integer as legacy_envelope_rows,
            count(*) filter(where information not like '<!-- mango-node-text-block-v1 -->%')::integer as unsupported_source_rows,
            count(*) filter(where not exists (
              select 1 from nodes parent
               where parent.company_id=missing.company_id and parent.node_id=missing.node_id
            ))::integer as missing_parent_rows,
            count(*) filter(where exists (
              select 1 from node_textboxes textbox
               where textbox.company_id=missing.company_id
                 and textbox.textbox_id=missing.information_id
                 and textbox.node_id<>missing.node_id
            ))::integer as textbox_id_on_different_node,
            count(*) filter(where exists (
              select 1 from node_information history
               where history.company_id=missing.company_id
                 and history.node_id=missing.node_id
                 and history.type='Saved version'::information_type
                 and history.source_information_id=missing.information_id
            ))::integer as rows_with_saved_history
       from missing`,
    [companyID],
  );
  return { company_id: companyID, ...result.rows[0] };
}

async function listMissingSources(client: pg.PoolClient, companyID: string): Promise<SourceRow[]> {
  const result = await client.query<SourceRow>(
    `with ranked as (
       select projection.company_id::text,
              projection.node_id::text,
              projection.information_id::text as textbox_id,
              projection.revision::text,
              projection.is_deleted,
              projection.information as source_information,
              projection.created_timestamp::text,
              projection.updated_timestamp::text,
              (row_number() over(
                partition by projection.company_id,projection.node_id
                order by projection.created_timestamp,projection.information_id
              )*1024)::text as display_order
         from node_projection_table projection
        where projection.company_id=$1::uuid
          and projection.type='Text box'::information_type
     )
     select ranked.*,
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'attachmentId',attachment.attachment_id::text,
                'sourceResourceAttachmentId',link.resource_attachment_id::text,
                'filename',attachment.original_filename,
                'mimeType',attachment.mime_type,
                'byteSize',attachment.byte_size,
                'sha256',attachment.sha256,
                'width',attachment.original_width,
                'height',attachment.original_height,
                'relationshipKind',link.relationship_kind
              ) order by
                case link.relationship_kind
                  when 'inline_image' then 0
                  when 'migrated_inline_image' then 1
                  when 'file_attachment' then 2
                  else 3
                end,
                attachment.attachment_id,link.resource_attachment_id)
                from resource_attachments link
                join attachments attachment
                  on attachment.company_id=link.company_id
                 and attachment.attachment_id=link.attachment_id
               where link.company_id=ranked.company_id::uuid
                 and link.resource_type='node'
                 and link.resource_id=ranked.node_id
                 and link.information_id=ranked.textbox_id::uuid
                 and link.deleted_timestamp is null
                 and attachment.deleted_timestamp is null
            ),'[]'::jsonb) as attachment_metadata
       from ranked
      where not ranked.is_deleted
        and not exists (
          select 1 from node_textboxes textbox
           where textbox.company_id=ranked.company_id::uuid
           and textbox.node_id=ranked.node_id::uuid
           and textbox.textbox_id=ranked.textbox_id::uuid
      )
      order by ranked.node_id::uuid,ranked.textbox_id::uuid`,
    [companyID],
  );
  return result.rows;
}

function convertSource(source: SourceRow): ConvertedRow {
  if (!/^\d+$/.test(source.revision) || !/^\d+$/.test(source.display_order)) {
    throw new Error(`invalid_revision_or_display_order:${source.node_id}:${source.textbox_id}`);
  }
  const html = legacyNodeTextboxHTML(source.source_information);
  const attachments = normalizeAttachmentMetadata(source.attachment_metadata);
  const converted = convertMangoLegacyHTML(html, { attachments });
  const referencedAttachmentIDs = mangoAttachmentIDs(converted.document);
  const linkedAttachmentIDs = new Set(attachments.map((attachment) => attachment.attachmentId));
  const missingAttachmentIDs = referencedAttachmentIDs.filter((attachmentID) => !linkedAttachmentIDs.has(attachmentID));
  if (missingAttachmentIDs.length > 0) {
    throw new Error(`node_inline_image_has_no_active_resource_attachment:${source.node_id}:${source.textbox_id}:${missingAttachmentIDs.join(",")}`);
  }
  const body = v3NodeTextboxBody(converted.document);
  const targetJSON = stableJSON(body);
  return {
    ...source,
    body,
    report: {
      node_id: source.node_id,
      textbox_id: source.textbox_id,
      revision: source.revision,
      display_order: source.display_order,
      source_bytes: Buffer.byteLength(html, "utf8"),
      target_json_bytes: Buffer.byteLength(targetJSON, "utf8"),
      source_sha256: sha256(html),
      target_sha256: sha256(targetJSON),
      normalized_text_sha256: sha256(converted.normalizedText),
      attachment_count: referencedAttachmentIDs.length,
      warnings: converted.warnings,
    },
  };
}

function assertExpectedCount(args: V3NodeTextboxBackfillArguments, actual: number): void {
  if (args.expectedCount !== null && args.expectedCount !== actual) {
    throw new Error(`expected_count_mismatch:expected=${args.expectedCount}:actual=${actual}`);
  }
}

async function assertNoAmbiguousIdentity(client: pg.PoolClient, companyID: string): Promise<void> {
  const result = await client.query(
    `select count(*)::integer as count
       from node_projection_table projection
       join node_textboxes textbox
         on textbox.company_id=projection.company_id
        and textbox.textbox_id=projection.information_id
        and textbox.node_id<>projection.node_id
      where projection.company_id=$1::uuid
        and not projection.is_deleted
        and projection.type='Text box'::information_type
        and not exists (
          select 1 from node_textboxes exact_target
           where exact_target.company_id=projection.company_id
             and exact_target.node_id=projection.node_id
             and exact_target.textbox_id=projection.information_id
        )`,
    [companyID],
  );
  if (Number(result.rows[0].count) !== 0) throw new Error("textbox_id_exists_on_a_different_node");
}

async function insertAndVerify(client: pg.PoolClient, source: ConvertedRow): Promise<void> {
  const bodyJSON = JSON.stringify(source.body);
  const inserted = await client.query(
    `insert into node_textboxes(
       company_id,node_id,textbox_id,body_json,revision,display_order,
       created_timestamp,updated_timestamp,deleted_timestamp
     ) values($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::bigint,$6::bigint,$7::timestamptz,$8::timestamptz,null)
     returning company_id::text`,
    [
      source.company_id, source.node_id, source.textbox_id, bodyJSON, source.revision,
      source.display_order, source.created_timestamp, source.updated_timestamp,
    ],
  );
  if (inserted.rowCount !== 1) throw new Error(`node_textbox_insert_failed:${source.node_id}:${source.textbox_id}`);

  const verified = await client.query(
    `select count(*)::integer as count
       from node_textboxes
      where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid
        and body_json=$4::jsonb and revision=$5::bigint and display_order=$6::bigint
        and created_timestamp=$7::timestamptz and updated_timestamp=$8::timestamptz
        and deleted_timestamp is null`,
    [
      source.company_id, source.node_id, source.textbox_id, bodyJSON, source.revision,
      source.display_order, source.created_timestamp, source.updated_timestamp,
    ],
  );
  if (Number(verified.rows[0].count) !== 1) {
    throw new Error(`node_textbox_readback_mismatch:${source.node_id}:${source.textbox_id}`);
  }
}

async function run(client: pg.PoolClient, args: V3NodeTextboxBackfillArguments): Promise<void> {
  const readOnly = args.mode !== "backfill";
  await client.query(readOnly ? "begin isolation level repeatable read read only" : "begin isolation level serializable");
  try {
    await client.query("set local lock_timeout='10s'");
    await client.query("set local statement_timeout='10min'");
    if (!readOnly) {
      await client.query(
        "lock table nodes,node_projection_table,node_information,node_textboxes,resource_attachments,attachments in share row exclusive mode",
      );
    }
    await assertSchema(client);
    const inventoryReport = await inventory(client, args.companyID);
    process.stdout.write(`${JSON.stringify({ inventory: inventoryReport })}\n`);
    const missingRows = Number(inventoryReport.missing_rows);
    assertExpectedCount(args, missingRows);
    if (args.mode === "inventory") {
      await client.query("rollback");
      return;
    }
    if (Number(inventoryReport.unsupported_source_rows) !== 0) throw new Error("unsupported_node_textbox_source_rows_found");
    if (Number(inventoryReport.missing_parent_rows) !== 0) throw new Error("missing_node_parent_rows_found");
    if (Number(inventoryReport.textbox_id_on_different_node) !== 0) throw new Error("textbox_id_exists_on_a_different_node");
    await assertNoAmbiguousIdentity(client, args.companyID);

    const sources = await listMissingSources(client, args.companyID);
    if (sources.length !== missingRows) throw new Error("missing_source_count_changed_inside_transaction");
    const converted = sources.map(convertSource);
    for (const row of converted) process.stdout.write(`${JSON.stringify({ converted: row.report })}\n`);

    if (args.mode === "dry-run") {
      process.stdout.write(`${JSON.stringify({ summary: true, mode: args.mode, converted: converted.length, inserted: 0 })}\n`);
      await client.query("rollback");
      return;
    }

    for (const source of converted) await insertAndVerify(client, source);
    const remaining = await inventory(client, args.companyID);
    if (Number(remaining.missing_rows) !== 0) throw new Error("missing_node_textbox_rows_remain_after_backfill");
    await client.query("commit");
    process.stdout.write(`${JSON.stringify({ summary: true, mode: args.mode, converted: converted.length, inserted: converted.length, remaining: 0 })}\n`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseV3NodeTextboxBackfillArguments(process.argv.slice(2));
  assertV3NodeTextboxBackfillSafety(args);
  const databaseURL = String(process.env.MANGORTS_MIGRATION_DATABASE_URL ?? "").trim();
  if (!databaseURL) throw new Error("MANGORTS_MIGRATION_DATABASE_URL is required");
  const pool = new Pool({
    connectionString: databaseURL,
    max: 1,
    application_name: "mangorts-v3-node-textbox-backfill",
  });
  const client = await pool.connect();
  try {
    await run(client, args);
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "unknown V3 Node textbox backfill failure"}\n`);
  process.exitCode = 1;
});
