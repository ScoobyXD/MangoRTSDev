import { createHash, randomUUID } from "node:crypto";


import { generateHTML } from "@tiptap/html/server";

import pg from "pg";
import * as Y from "yjs";

import { convertMangoLegacyHTML } from "./mango-html-to-json-core.js";
import { createMangoTiptapExtensions } from "../src/modules/editor/tiptap/mangoTiptapExtensions.js";
import { validateMangoTiptapDocument, type MangoTiptapDocument } from "../src/modules/editor/tiptap/mangoTiptapDocument.js";
import { mangoProsemirrorJSONToYDoc } from "../src/modules/editor/tiptap/mangoTiptapYjs.js";

const { Pool } = pg;

const OWNER_TYPES = ["node", "project", "logic_gate"] as const;
type OwnerType = typeof OWNER_TYPES[number];
type Mode = "inventory" | "dry-run" | "backfill" | "shadow" | "readiness" | "activate" | "rollback-export" | "rollback";

type Arguments = {
  mode: Mode;
  companyID: string;
  owners: OwnerType[];
  runID: string;
  batchSize: number;
  limit: number;
  allowWrite: boolean;
  confirmation: string;
  backupReference: string;
};

type SourceDocument = {
  company_id: string;
  resource_type: OwnerType;
  resource_id: string;
  document_id: string;
  revision: string;
  canonical_html: string;
  is_deleted: boolean;
  created_timestamp: Date;
  updated_timestamp: Date;
  display_order: string;
};

type SourceInventory = {
  owner_type: OwnerType;
  total_count: number;
  active_count: number;
  deleted_count: number;
  owner_count: number;
  source_bytes: number;
  largest_source_bytes: number;
};

type NodeInventory = {
  node_id: string;
  total_count: number;
  active_count: number;
  deleted_count: number;
  source_bytes: number;
  largest_source_bytes: number;
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJSON(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseArguments(argv: string[]): Arguments {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-write") {
      flags.add(argument);
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`unexpected_argument:${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing_value:${argument}`);
    values.set(argument, value);
    index += 1;
  }
  const mode = String(values.get("--mode") || "") as Mode;
  if (!["inventory", "dry-run", "backfill", "shadow", "readiness", "activate", "rollback-export", "rollback"].includes(mode)) {
    throw new Error("mode must be inventory, dry-run, backfill, shadow, readiness, activate, rollback-export, or rollback");
  }
  const companyID = String(values.get("--company") || "").trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(companyID)) throw new Error("--company must be a UUID");
  const owner = String(values.get("--owner") || "node");
  const owners = owner === "all" ? [...OWNER_TYPES] : [owner as OwnerType];
  if (owners.some((item) => !OWNER_TYPES.includes(item))) throw new Error("--owner must be node, project, logic_gate, or all");
  const batchSize = Number(values.get("--batch-size") || 100);
  const limit = Number(values.get("--limit") || Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error("--batch-size must be from 1 through 1000");
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  return {
    mode,
    companyID,
    owners,
    runID: String(values.get("--run-id") || randomUUID()).toLowerCase(),
    batchSize,
    limit,
    allowWrite: flags.has("--allow-write"),
    confirmation: String(values.get("--confirm") || ""),
    backupReference: String(values.get("--backup-reference") || "").trim(),
  };
}

function assertWriteSafety(args: Arguments): void {
  if (!["backfill", "shadow", "readiness", "activate", "rollback-export", "rollback"].includes(args.mode)) return;
  if (!args.allowWrite) throw new Error(`${args.mode} requires --allow-write`);
  const verbs: Record<string, string> = {
    backfill: "BACKFILL",
    readiness: "VALIDATE",
    shadow: "SHADOW",
    activate: "ACTIVATE",
    "rollback-export": "EXPORT",
    rollback: "ROLLBACK",
  };
  if (args.confirmation !== `${verbs[args.mode]} ${args.companyID}`) {
    throw new Error(`${args.mode} requires --confirm "${verbs[args.mode]} ${args.companyID}"`);
  }
  if (["backfill", "shadow", "activate", "rollback-export", "rollback"].includes(args.mode) && !args.backupReference) {
    throw new Error(`${args.mode} requires --backup-reference`);
  }
}

async function listSources(
  client: pg.PoolClient,
  companyID: string,
  owner: OwnerType,
  after: { resourceID: string; documentID: string } | null,
  limit: number,
): Promise<SourceDocument[]> {
  if (owner === "node") {
    const result = await client.query<SourceDocument>(
      `with ranked as (
         select company_id::text,
                'node'::text as resource_type,
                node_id::text as resource_id,
                information_id::text as document_id,
                revision::text,
                information as canonical_html,
                is_deleted,
                created_timestamp,
                updated_timestamp,
                (row_number() over(partition by company_id,node_id order by created_timestamp,information_id)*1024)::text as display_order
           from node_projection_table
          where company_id=$1::uuid and type='Text box'::information_type
       )
       select * from ranked
        where ($2::uuid is null or (resource_id::uuid,document_id::uuid)>($2::uuid,$3::uuid))
        order by resource_id::uuid,document_id::uuid
        limit $4`,
      [companyID, after?.resourceID ?? null, after?.documentID ?? null, limit],
    );
    return result.rows;
  }
  const result = await client.query<SourceDocument>(
    `select company_id::text,resource_type,resource_id::text,document_id::text,revision::text,canonical_html,
            is_deleted,created_timestamp,updated_timestamp,'0'::text as display_order
       from editor_collaboration_documents
      where company_id=$1::uuid and resource_type=$2 and not is_deleted
        and ($3::uuid is null or (resource_id,document_id)>($3::uuid,$4::uuid))
      order by resource_id,document_id
      limit $5`,
    [companyID, owner, after?.resourceID ?? null, after?.documentID ?? null, limit],
  );
  return result.rows;
}

async function sourceInventory(client: pg.PoolClient, companyID: string, owner: OwnerType): Promise<SourceInventory> {
  const result = owner === "node"
    ? await client.query(
      `select count(*)::integer as total_count,
              count(*) filter(where not is_deleted)::integer as active_count,
              count(*) filter(where is_deleted)::integer as deleted_count,
              count(distinct node_id)::integer as owner_count,
              coalesce(sum(octet_length(information)),0)::bigint as source_bytes,
              coalesce(max(octet_length(information)),0)::integer as largest_source_bytes
         from node_projection_table
        where company_id=$1::uuid and type='Text box'::information_type`,
      [companyID],
    )
    : await client.query(
      `select count(*)::integer as total_count,
              count(*)::integer as active_count,
              0::integer as deleted_count,
              count(distinct resource_id)::integer as owner_count,
              coalesce(sum(octet_length(canonical_html)),0)::bigint as source_bytes,
              coalesce(max(octet_length(canonical_html)),0)::integer as largest_source_bytes
         from editor_collaboration_documents
        where company_id=$1::uuid and resource_type=$2 and not is_deleted`,
      [companyID, owner],
    );
  const row = result.rows[0];
  return {
    owner_type: owner,
    total_count: Number(row.total_count),
    active_count: Number(row.active_count),
    deleted_count: Number(row.deleted_count),
    owner_count: Number(row.owner_count),
    source_bytes: Number(row.source_bytes),
    largest_source_bytes: Number(row.largest_source_bytes),
  };
}

async function nodeInventory(client: pg.PoolClient, companyID: string): Promise<NodeInventory[]> {
  const result = await client.query(
    `select node_id::text,
            count(*)::integer as total_count,
            count(*) filter(where not is_deleted)::integer as active_count,
            count(*) filter(where is_deleted)::integer as deleted_count,
            coalesce(sum(octet_length(information)),0)::bigint as source_bytes,
            coalesce(max(octet_length(information)),0)::integer as largest_source_bytes
       from node_projection_table
      where company_id=$1::uuid and type='Text box'::information_type
      group by node_id
      order by node_id`,
    [companyID],
  );
  return result.rows.map((row) => ({
    node_id: String(row.node_id),
    total_count: Number(row.total_count),
    active_count: Number(row.active_count),
    deleted_count: Number(row.deleted_count),
    source_bytes: Number(row.source_bytes),
    largest_source_bytes: Number(row.largest_source_bytes),
  }));
}

function identityFor(source: SourceDocument, sourceSHA: string): string {
  return sha256([source.company_id, source.resource_type, source.resource_id, source.document_id, source.revision, sourceSHA].join(":"));
}

async function ensureRun(client: pg.PoolClient, args: Arguments, expectedCount: number): Promise<void> {
  const ownerType = args.owners.length === 1 ? args.owners[0] : "all";
  const mode = args.mode === "rollback-export"
    ? "rollback_export"
    : args.mode === "backfill"
      ? "backfill"
      : args.mode === "shadow"
        ? "shadow_validate"
        : "dry_run";
  const result = await client.query(
    `insert into editor_conversion_runs(
       conversion_run_id,company_id,owner_type,mode,status,batch_size,source_snapshot_timestamp,
       backup_reference,expected_count,started_timestamp
     ) values($1::uuid,$2::uuid,$3,$4,'running',$5,clock_timestamp(),$6,$7,clock_timestamp())
     on conflict(conversion_run_id) do update set
       status='running',
       started_timestamp=coalesce(editor_conversion_runs.started_timestamp,excluded.started_timestamp)
     where editor_conversion_runs.company_id=excluded.company_id
       and editor_conversion_runs.owner_type=excluded.owner_type
       and (
         editor_conversion_runs.mode=excluded.mode
         or (editor_conversion_runs.mode='backfill' and excluded.mode='shadow_validate')
       )
       and editor_conversion_runs.batch_size=excluded.batch_size
       and editor_conversion_runs.backup_reference=excluded.backup_reference
       and editor_conversion_runs.expected_count=excluded.expected_count
     returning conversion_run_id`,
    [args.runID, args.companyID, ownerType, mode, args.batchSize, args.backupReference, expectedCount],
  );
  if (result.rowCount !== 1) {
    throw new Error("conversion_run_identity_conflict");
  }
}

async function writeTransitionalNodeTarget(
  client: pg.PoolClient,
  source: SourceDocument,
  document: MangoTiptapDocument,
): Promise<void> {
  await client.query(
    `insert into editor_json_documents(
       company_id,resource_type,resource_id,document_id,document_schema_version,revision,
       canonical_document,canonical_annotations,is_deleted,created_timestamp,updated_timestamp
     ) values($1::uuid,'node',$2,$3,1,$4,$5::jsonb,'[]'::jsonb,$6,$7,$8)
     on conflict(company_id,resource_type,resource_id,document_id) do update set
       document_schema_version=excluded.document_schema_version,
       canonical_document=excluded.canonical_document,
       is_deleted=excluded.is_deleted,
       updated_timestamp=clock_timestamp()
     where editor_json_documents.revision=0`,
    [
      source.company_id,
      source.resource_id,
      source.document_id,
      Number(source.revision),
      JSON.stringify(document),
      source.is_deleted,
      source.created_timestamp,
      source.updated_timestamp,
    ],
  );
  const target = await client.query(
    `select canonical_document,is_deleted
       from editor_json_documents
      where company_id=$1::uuid and resource_type='node' and resource_id=$2 and document_id=$3`,
    [source.company_id, source.resource_id, source.document_id],
  );
  if (
    target.rowCount !== 1
    || stableJSON(target.rows[0].canonical_document) !== stableJSON(document)
    || Boolean(target.rows[0].is_deleted) !== source.is_deleted
  ) {
    throw new Error("editor_json_target_identity_conflict");
  }
}

async function writeNodeTarget(
  client: pg.PoolClient,
  source: SourceDocument,
  document: MangoTiptapDocument,
  plainText: string,
  sourceSHA: string,
  targetSHA: string,
  runID: string,
): Promise<void> {
  const yDocument = mangoProsemirrorJSONToYDoc(document.document, "default");
  const checkpoint = Y.encodeStateAsUpdate(yDocument);
  const stateVector = Y.encodeStateVector(yDocument);
  const proposedEpoch = randomUUID();
  yDocument.destroy();
  await client.query(
    `insert into node_textboxes(
       company_id,node_id,textbox_id,source_information_id,document_schema_version,document_json,plain_text,
       content_revision,collaboration_epoch,latest_update_sequence,materialized_through_sequence,display_order,
       source_html_sha256,target_json_sha256,conversion_run_id,created_timestamp,updated_timestamp,deleted_timestamp
     ) values(
       $1::uuid,$2::uuid,$3::uuid,$3::uuid,1,$4::jsonb,$5,0,$6::uuid,0,0,$7::bigint,
       $8,$9,$10::uuid,$11::timestamptz,$12::timestamptz,
       case when $13::boolean then $12::timestamptz else null::timestamptz end
     )
     on conflict(company_id,node_id,textbox_id) do nothing`,
    [
      source.company_id,
      source.resource_id,
      source.document_id,
      JSON.stringify(document),
      plainText,
      proposedEpoch,
      Number(source.display_order),
      sourceSHA,
      targetSHA,
      runID,
      source.created_timestamp,
      source.updated_timestamp,
      source.is_deleted,
    ],
  );
  const target = await client.query(
    `select collaboration_epoch::text,document_json,plain_text,source_html_sha256,target_json_sha256,
            latest_update_sequence,materialized_through_sequence,deleted_timestamp is not null as is_deleted
       from node_textboxes
      where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`,
    [source.company_id, source.resource_id, source.document_id],
  );
  if (
    target.rowCount !== 1
    || stableJSON(target.rows[0].document_json) !== stableJSON(document)
    || String(target.rows[0].plain_text) !== plainText
    || target.rows[0].source_html_sha256 !== sourceSHA
    || target.rows[0].target_json_sha256 !== targetSHA
    || Number(target.rows[0].latest_update_sequence) !== 0
    || Number(target.rows[0].materialized_through_sequence) !== 0
    || Boolean(target.rows[0].is_deleted) !== source.is_deleted
  ) {
    throw new Error("node_target_identity_conflict");
  }
  await client.query(
    `insert into node_textbox_yjs_checkpoints(
       company_id,node_id,textbox_id,checkpoint_id,collaboration_epoch,through_update_sequence,
       checkpoint_payload,state_vector,document_schema_version,document_json,plain_text,checkpoint_reason,retain_until
     ) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,0,$6,$7,1,$8::jsonb,$9,'migration_seed',clock_timestamp()+interval '100 years')
     on conflict(company_id,node_id,textbox_id,collaboration_epoch,through_update_sequence) do nothing`,
    [
      source.company_id,
      source.resource_id,
      source.document_id,
      randomUUID(),
      target.rows[0].collaboration_epoch,
      Buffer.from(checkpoint),
      Buffer.from(stateVector),
      JSON.stringify(document),
      plainText,
    ],
  );
  const checkpointTarget = await client.query(
    `select document_json,plain_text
       from node_textbox_yjs_checkpoints
      where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid
        and collaboration_epoch=$4::uuid and through_update_sequence=0`,
    [source.company_id, source.resource_id, source.document_id, target.rows[0].collaboration_epoch],
  );
  if (
    checkpointTarget.rowCount !== 1
    || stableJSON(checkpointTarget.rows[0].document_json) !== stableJSON(document)
    || String(checkpointTarget.rows[0].plain_text) !== plainText
  ) {
    throw new Error("node_checkpoint_target_identity_conflict");
  }
}

async function writeOwnedTarget(
  client: pg.PoolClient,
  source: SourceDocument,
  document: MangoTiptapDocument,
  plainText: string,
  sourceSHA: string,
  targetSHA: string,
  runID: string,
): Promise<void> {
  const table = source.resource_type === "project" ? "project_editor_documents" : "logic_gate_editor_documents";
  const ownerColumn = source.resource_type === "project" ? "project_id" : "logic_gate_id";
  await client.query(
    `insert into ${table}(
       company_id,${ownerColumn},document_id,source_document_id,document_schema_version,revision,document_json,
       plain_text,source_html,source_html_sha256,target_json_sha256,conversion_run_id
     ) values($1::uuid,$2::uuid,$3, $3,1,0,$4::jsonb,$5,$6,$7,$8,$9::uuid)
     on conflict(company_id,${ownerColumn},document_id) do nothing`,
    [source.company_id, source.resource_id, source.document_id, JSON.stringify(document), plainText, source.canonical_html, sourceSHA, targetSHA, runID],
  );
  const target = await client.query(
    `select source_html_sha256,target_json_sha256 from ${table}
      where company_id=$1::uuid and ${ownerColumn}=$2::uuid and document_id=$3`,
    [source.company_id, source.resource_id, source.document_id],
  );
  if (target.rowCount !== 1 || target.rows[0].source_html_sha256 !== sourceSHA || target.rows[0].target_json_sha256 !== targetSHA) {
    throw new Error(`${source.resource_type}_target_identity_conflict`);
  }
}

async function assertSourceCurrent(client: pg.PoolClient, source: SourceDocument): Promise<void> {
  const result = source.resource_type === "node"
    ? await client.query(
      `select revision::text,information as canonical_html,is_deleted
         from node_projection_table
        where company_id=$1::uuid and node_id=$2::uuid and information_id=$3::uuid
          and type='Text box'::information_type
        for share`,
      [source.company_id, source.resource_id, source.document_id],
    )
    : await client.query(
      `select revision::text,canonical_html,is_deleted
         from editor_collaboration_documents
        where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid and document_id=$4::uuid
        for share`,
      [source.company_id, source.resource_type, source.resource_id, source.document_id],
    );
  const current = result.rows[0];
  if (
    result.rowCount !== 1
    || String(current.revision) !== source.revision
    || String(current.canonical_html) !== source.canonical_html
    || Boolean(current.is_deleted) !== source.is_deleted
  ) {
    throw new Error("legacy_source_changed_during_conversion");
  }
}

async function recordFailedItem(
  client: pg.PoolClient,
  source: SourceDocument,
  runID: string,
  itemIdentity: string,
  sourceSHA: string,
  error: unknown,
): Promise<void> {
  await client.query(
    `insert into editor_conversion_items(
       conversion_run_id,company_id,owner_type,owner_id,document_id,source_revision,item_identity_sha256,source_html_snapshot,
       source_html_sha256,status,failure_report
     ) values($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9,'failed',$10::jsonb)
     on conflict(conversion_run_id,owner_type,owner_id,document_id) do update set
       retry_count=editor_conversion_items.retry_count+1,status='failed',failure_report=excluded.failure_report
     where editor_conversion_items.item_identity_sha256=excluded.item_identity_sha256`,
    [
      runID,
      source.company_id,
      source.resource_type,
      source.resource_id,
      source.document_id,
      Number(source.revision),
      itemIdentity,
      source.canonical_html,
      sourceSHA,
      JSON.stringify({ error: error instanceof Error ? error.message : "unknown" }),
    ],
  );
}

async function convertAndMaybeWrite(client: pg.PoolClient, source: SourceDocument, args: Arguments): Promise<Record<string, unknown>> {
  const sourceSHA = sha256(source.canonical_html);
  const itemIdentity = identityFor(source, sourceSHA);
  let converted: ReturnType<typeof convertMangoLegacyHTML>;
  let document: MangoTiptapDocument;
  try {
    converted = convertMangoLegacyHTML(source.canonical_html);
    const validation = validateMangoTiptapDocument(converted.document);
    if (!validation.valid) throw new Error(validation.error);
    document = validation.value;
  } catch (error) {
    if (args.mode === "backfill") await recordFailedItem(client, source, args.runID, itemIdentity, sourceSHA, error);
    throw error;
  }
  const targetSerialized = stableJSON(document);
  const targetSHA = sha256(targetSerialized);
  const report = {
    owner_type: source.resource_type,
    owner_id: source.resource_id,
    document_id: source.document_id,
    source_revision: Number(source.revision),
    source_deleted: source.is_deleted,
    source_bytes: Buffer.byteLength(source.canonical_html, "utf8"),
    target_json_bytes: Buffer.byteLength(targetSerialized, "utf8"),
    source_sha256: sourceSHA,
    target_sha256: targetSHA,
    normalized_text_sha256: sha256(converted.normalizedText),
    item_identity_sha256: itemIdentity,
    text_match: true,
    structure_match: true,
    source_structure_counts: converted.sourceCounts,
    target_structure_counts: converted.jsonCounts,
    warnings: converted.warnings,
    comment_anchor_report: { strategy: "quote-plus-context-to-yjs-relative-position", requires_review: converted.warnings.length > 0 },
    attachment_reference_report: { inline_images: converted.jsonCounts.attachmentImages, preserved_by_attachment_id: true },
  };
  if (args.mode !== "backfill") return report;

  await client.query("begin");
  try {
    await assertSourceCurrent(client, source);
    const ledgerItem = await client.query(
      `insert into editor_conversion_items(
       conversion_run_id,company_id,owner_type,owner_id,document_id,source_revision,item_identity_sha256,source_html_snapshot,
       source_html_sha256,target_json_sha256,status,warning_report,comment_anchor_report,attachment_reference_report,converted_timestamp
       ) values($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,clock_timestamp())
       on conflict(conversion_run_id,owner_type,owner_id,document_id) do update set
         retry_count=editor_conversion_items.retry_count+1,
         status=excluded.status,
          warning_report=excluded.warning_report,
          failure_report=null,
          converted_timestamp=excluded.converted_timestamp
        where editor_conversion_items.item_identity_sha256=excluded.item_identity_sha256
        returning item_identity_sha256`,
      [
        args.runID, source.company_id, source.resource_type, source.resource_id, source.document_id, Number(source.revision), itemIdentity,
        source.canonical_html, sourceSHA, targetSHA, converted.warnings.length ? "warning" : "converted",
        JSON.stringify(converted.warnings), JSON.stringify(report.comment_anchor_report), JSON.stringify(report.attachment_reference_report),
      ],
    );
    if (ledgerItem.rowCount !== 1) throw new Error("source_identity_changed_for_run");
    if (source.resource_type === "node") {
      await writeTransitionalNodeTarget(client, source, document);
      await writeNodeTarget(client, source, document, converted.normalizedText, sourceSHA, targetSHA, args.runID);
    } else {
      await writeOwnedTarget(client, source, document, converted.normalizedText, sourceSHA, targetSHA, args.runID);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    await recordFailedItem(client, source, args.runID, itemIdentity, sourceSHA, error);
    throw error;
  }
  return report;
}

async function sourceCount(client: pg.PoolClient, companyID: string, owners: readonly OwnerType[]): Promise<number> {
  const inventories = await Promise.all(owners.map((owner) => sourceInventory(client, companyID, owner)));
  return inventories.reduce((total, inventory) => total + inventory.total_count, 0);
}

async function runConversion(client: pg.PoolClient, args: Arguments): Promise<void> {
  const inventories = await Promise.all(args.owners.map((owner) => sourceInventory(client, args.companyID, owner)));
  const expected = inventories.reduce((total, inventory) => total + inventory.total_count, 0);
  if (args.mode === "inventory") {
    const perNode = args.owners.includes("node") ? await nodeInventory(client, args.companyID) : [];
    process.stdout.write(`${JSON.stringify({
      company_id: args.companyID,
      owners: args.owners,
      expected_count: expected,
      active_count: inventories.reduce((total, inventory) => total + inventory.active_count, 0),
      deleted_count: inventories.reduce((total, inventory) => total + inventory.deleted_count, 0),
      source_bytes: inventories.reduce((total, inventory) => total + inventory.source_bytes, 0),
      owner_totals: inventories,
      per_node_totals: perNode,
    })}\n`);
    return;
  }
  if (args.mode === "backfill") await ensureRun(client, args, expected);
  let processed = 0;
  let failed = 0;
  const perNode = new Map<string, {
    node_id: string;
    processed: number;
    active: number;
    deleted: number;
    failed: number;
    source_bytes: number;
    target_json_bytes: number;
  }>();
  for (const owner of args.owners) {
    let after: { resourceID: string; documentID: string } | null = null;
    while (processed < args.limit) {
      const sources = await listSources(client, args.companyID, owner, after, Math.min(args.batchSize, args.limit - processed));
      if (sources.length === 0) break;
      for (const source of sources) {
        const nodeTotal = source.resource_type === "node"
          ? perNode.get(source.resource_id) ?? {
            node_id: source.resource_id,
            processed: 0,
            active: 0,
            deleted: 0,
            failed: 0,
            source_bytes: 0,
            target_json_bytes: 0,
          }
          : null;
        if (nodeTotal) {
          nodeTotal.processed += 1;
          nodeTotal.active += source.is_deleted ? 0 : 1;
          nodeTotal.deleted += source.is_deleted ? 1 : 0;
          nodeTotal.source_bytes += Buffer.byteLength(source.canonical_html, "utf8");
          perNode.set(source.resource_id, nodeTotal);
        }
        try {
          const report = await convertAndMaybeWrite(client, source, args);
          process.stdout.write(`${JSON.stringify({ status: "ok", ...report })}\n`);
          if (nodeTotal) nodeTotal.target_json_bytes += Number(report.target_json_bytes);
        } catch (error) {
          failed += 1;
          if (nodeTotal) nodeTotal.failed += 1;
          process.stdout.write(`${JSON.stringify({ status: "failed", owner_type: source.resource_type, owner_id: source.resource_id, document_id: source.document_id, error: error instanceof Error ? error.message : "unknown" })}\n`);
        }
        processed += 1;
      }
      const last = sources.at(-1)!;
      after = { resourceID: last.resource_id, documentID: last.document_id };
    }
  }
  if (args.mode === "backfill") {
    await client.query(
      `with totals as (
         select count(*) filter(where status in ('converted','warning','validated'))::bigint as converted,
                count(*) filter(where status='warning')::bigint as warnings,
                count(*) filter(where status='failed')::bigint as failures
           from editor_conversion_items
          where conversion_run_id=$1::uuid
       )
       update editor_conversion_runs run set
         converted_count=totals.converted,
         warning_count=totals.warnings,
         failed_count=totals.failures,
         status=case
           when totals.failures > 0 or $2::integer > 0 then 'failed'
           when totals.converted = run.expected_count then 'completed'
           else 'paused'
         end,
         completed_timestamp=case when totals.failures=0 and $2::integer=0 and totals.converted=run.expected_count then clock_timestamp() else null end
       from totals
       where run.conversion_run_id=$1::uuid`,
      [args.runID, failed],
    );
  }
  if (perNode.size > 0) {
    process.stdout.write(`${JSON.stringify({ per_node_totals: [...perNode.values()].sort((left, right) => left.node_id.localeCompare(right.node_id)) })}\n`);
  }
  process.stdout.write(`${JSON.stringify({ summary: true, expected, processed, failed, run_id: args.runID, mode: args.mode })}\n`);
  if (failed > 0) process.exitCode = 2;
}

async function shadowValidate(client: pg.PoolClient, args: Arguments): Promise<void> {
  let mismatches = 0;
  if (args.allowWrite) await ensureRun(client, args, await sourceCount(client, args.companyID, args.owners));
  for (const owner of args.owners) {
    const sources = await listSources(client, args.companyID, owner, null, args.limit);
    for (const source of sources) {
      const converted = convertMangoLegacyHTML(source.canonical_html);
      const expectedSHA = sha256(stableJSON(converted.document));
      let actualSHA = sha256("");
      let equivalent = false;
      let differences: Array<Record<string, unknown>> = [];
      if (owner === "node") {
        const target = await client.query(
          `select textbox.document_json as permanent_document,
                  textbox.plain_text as permanent_plain_text,
                  textbox.deleted_timestamp is not null as permanent_deleted,
                  transitional.canonical_document as transitional_document,
                  transitional.is_deleted as transitional_deleted,
                  checkpoint.document_json as checkpoint_document,
                  checkpoint.plain_text as checkpoint_plain_text
             from node_textboxes textbox
             left join editor_json_documents transitional
               on transitional.company_id=textbox.company_id
              and transitional.resource_type='node'
              and transitional.resource_id=textbox.node_id::text
              and transitional.document_id=textbox.textbox_id::text
             left join node_textbox_yjs_checkpoints checkpoint
               on checkpoint.company_id=textbox.company_id
              and checkpoint.node_id=textbox.node_id
              and checkpoint.textbox_id=textbox.textbox_id
              and checkpoint.collaboration_epoch=textbox.collaboration_epoch
              and checkpoint.through_update_sequence=0
            where textbox.company_id=$1::uuid and textbox.node_id=$2::uuid and textbox.textbox_id=$3::uuid`,
          [args.companyID, source.resource_id, source.document_id],
        );
        if (target.rowCount !== 1) {
          differences = [{ kind: "missing_node_targets" }];
        } else {
          const row = target.rows[0];
          const permanentSHA = sha256(stableJSON(row.permanent_document));
          const transitionalSHA = row.transitional_document ? sha256(stableJSON(row.transitional_document)) : sha256("");
          const checkpointSHA = row.checkpoint_document ? sha256(stableJSON(row.checkpoint_document)) : sha256("");
          actualSHA = permanentSHA;
          if (permanentSHA !== expectedSHA) differences.push({ kind: "permanent_json_checksum", expected_sha256: expectedSHA, actual_sha256: permanentSHA });
          if (transitionalSHA !== expectedSHA) differences.push({ kind: "transitional_json_checksum", expected_sha256: expectedSHA, actual_sha256: transitionalSHA });
          if (checkpointSHA !== expectedSHA) differences.push({ kind: "checkpoint_json_checksum", expected_sha256: expectedSHA, actual_sha256: checkpointSHA });
          if (String(row.permanent_plain_text) !== converted.normalizedText) differences.push({ kind: "permanent_plain_text" });
          if (String(row.checkpoint_plain_text) !== converted.normalizedText) differences.push({ kind: "checkpoint_plain_text" });
          if (Boolean(row.permanent_deleted) !== source.is_deleted) differences.push({ kind: "permanent_deleted_state" });
          if (Boolean(row.transitional_deleted) !== source.is_deleted) differences.push({ kind: "transitional_deleted_state" });
        }
        equivalent = differences.length === 0;
      } else {
        const table = owner === "project" ? "project_editor_documents" : "logic_gate_editor_documents";
        const column = owner === "project" ? "project_id" : "logic_gate_id";
        const target = await client.query(`select document_json from ${table} where company_id=$1::uuid and ${column}=$2::uuid and document_id=$3`, [args.companyID, source.resource_id, source.document_id]);
        actualSHA = target.rowCount === 1 ? sha256(stableJSON(target.rows[0].document_json)) : sha256("");
        equivalent = expectedSHA === actualSHA;
        differences = equivalent ? [] : [{ kind: "json_checksum", expected_sha256: expectedSHA, actual_sha256: actualSHA }];
      }
      if (!equivalent) mismatches += 1;
      if (args.allowWrite) {
        await client.query(
          `insert into editor_shadow_comparisons(
           comparison_id,conversion_run_id,company_id,owner_type,owner_id,document_id,legacy_sha256,json_sha256,
           rendered_text_sha256,equivalent,differences,latency_ms
           ) values($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7,$8,$9,$10,$11::jsonb,$12)
           on conflict(conversion_run_id,owner_type,owner_id,document_id) do update set
             legacy_sha256=excluded.legacy_sha256,json_sha256=excluded.json_sha256,
             rendered_text_sha256=excluded.rendered_text_sha256,equivalent=excluded.equivalent,
             differences=excluded.differences,latency_ms=excluded.latency_ms,compared_timestamp=clock_timestamp()`,
          [randomUUID(), args.runID, args.companyID, owner, source.resource_id, source.document_id,
            sha256(source.canonical_html), actualSHA, sha256(converted.normalizedText), equivalent, JSON.stringify(differences), 0],
        );
      }
      process.stdout.write(`${JSON.stringify({
        owner_type: owner,
        owner_id: source.resource_id,
        document_id: source.document_id,
        source_deleted: source.is_deleted,
        equivalent,
        expected_sha256: expectedSHA,
        actual_sha256: actualSHA,
        differences,
      })}\n`);
    }
  }
  process.stdout.write(`${JSON.stringify({ summary: true, mismatches })}\n`);
  if (mismatches > 0) process.exitCode = 2;
}

async function validateReadiness(client: pg.PoolClient, args: Arguments): Promise<void> {
  for (const owner of args.owners) {
    const inventory = await sourceInventory(client, args.companyID, owner);
    let convertedTotal = 0;
    let convertedActive = 0;
    let convertedDeleted = 0;
    let transitionalTotal = inventory.total_count;
    let checkpointTotal = inventory.total_count;
    if (owner === "node") {
      const targetResult = await client.query(
        `select count(*)::bigint as total,
                count(*) filter(where target.deleted_timestamp is null)::bigint as active,
                count(*) filter(where target.deleted_timestamp is not null)::bigint as deleted
           from node_projection_table source
           join node_textboxes target
             on target.company_id=source.company_id
            and target.node_id=source.node_id
            and target.textbox_id=source.information_id
            and target.source_information_id=source.information_id
          where source.company_id=$1::uuid and source.type='Text box'::information_type`,
        [args.companyID],
      );
      convertedTotal = Number(targetResult.rows[0].total);
      convertedActive = Number(targetResult.rows[0].active);
      convertedDeleted = Number(targetResult.rows[0].deleted);
      const transitionalResult = await client.query(
        `select count(*)::bigint as count
           from node_projection_table source
           join editor_json_documents target
             on target.company_id=source.company_id
            and target.resource_type='node'
            and target.resource_id=source.node_id::text
            and target.document_id=source.information_id::text
          where source.company_id=$1::uuid and source.type='Text box'::information_type`,
        [args.companyID],
      );
      transitionalTotal = Number(transitionalResult.rows[0].count);
      const checkpointResult = await client.query(
        `select count(*)::bigint as count
           from node_projection_table source
           join node_textboxes target
             on target.company_id=source.company_id
            and target.node_id=source.node_id
            and target.textbox_id=source.information_id
           join node_textbox_yjs_checkpoints checkpoint
             on checkpoint.company_id=target.company_id
            and checkpoint.node_id=target.node_id
            and checkpoint.textbox_id=target.textbox_id
            and checkpoint.collaboration_epoch=target.collaboration_epoch
            and checkpoint.through_update_sequence=0
          where source.company_id=$1::uuid and source.type='Text box'::information_type`,
        [args.companyID],
      );
      checkpointTotal = Number(checkpointResult.rows[0].count);
    } else {
      const targetQuery = owner === "project"
        ? "select count(*)::bigint as count from project_editor_documents where company_id=$1::uuid"
        : "select count(*)::bigint as count from logic_gate_editor_documents where company_id=$1::uuid";
      const targetResult = await client.query(targetQuery, [args.companyID]);
      convertedTotal = Number(targetResult.rows[0].count);
      convertedActive = convertedTotal;
    }
    const failureResult = await client.query("select count(*)::bigint as count from editor_conversion_items where conversion_run_id=$1::uuid and owner_type=$2 and status='failed'", [args.runID, owner]);
    const comparisonResult = await client.query(
      "select count(*)::bigint as compared,count(*) filter(where not equivalent)::bigint as mismatches from editor_shadow_comparisons where conversion_run_id=$1::uuid and owner_type=$2",
      [args.runID, owner],
    );
    const failed = Number(failureResult.rows[0].count);
    const compared = Number(comparisonResult.rows[0].compared);
    const mismatches = Number(comparisonResult.rows[0].mismatches);
    const ready = inventory.total_count === convertedTotal
      && inventory.active_count === convertedActive
      && inventory.deleted_count === convertedDeleted
      && transitionalTotal === inventory.total_count
      && checkpointTotal === inventory.total_count
      && failed === 0
      && compared === inventory.total_count
      && mismatches === 0;
    await client.query(
      `insert into editor_rollout_gates(company_id,owner_type,rollout_state,expected_count,converted_count,failed_count,shadow_mismatch_count,validation_run_id,validated_timestamp)
       values($1::uuid,$2,$3,$4,$5,$6,$7,$8::uuid,case when $3='ready' then clock_timestamp() end)
       on conflict(company_id,owner_type) do update set rollout_state=excluded.rollout_state,expected_count=excluded.expected_count,
       converted_count=excluded.converted_count,failed_count=excluded.failed_count,shadow_mismatch_count=excluded.shadow_mismatch_count,
       validation_run_id=excluded.validation_run_id,validated_timestamp=excluded.validated_timestamp,updated_timestamp=clock_timestamp()`,
      [args.companyID, owner, ready ? "ready" : "shadow", inventory.active_count, convertedActive, failed, mismatches, args.runID],
    );
    process.stdout.write(`${JSON.stringify({
      owner_type: owner,
      expected_total: inventory.total_count,
      expected_active: inventory.active_count,
      expected_deleted: inventory.deleted_count,
      converted_total: convertedTotal,
      converted_active: convertedActive,
      converted_deleted: convertedDeleted,
      transitional_total: transitionalTotal,
      checkpoint_total: checkpointTotal,
      failed,
      compared,
      mismatches,
      ready,
    })}\n`);
    if (!ready) process.exitCode = 2;
  }
}

async function activate(client: pg.PoolClient, args: Arguments): Promise<void> {
  if (args.owners.length !== 3) throw new Error("activation is company-wide and requires --owner all");
  await client.query("begin");
  try {
    await client.query("lock table node_projection_table,editor_collaboration_documents in share mode");
    const sourceRows = await client.query(
      `with source as (
         select company_id,'node'::text as resource_type,node_id as resource_id,
                information_id::text as document_id,revision,information as canonical_html
           from node_projection_table
          where company_id=$1::uuid and type='Text box'::information_type and not is_deleted
         union all
         select company_id,resource_type,resource_id,document_id::text,revision,canonical_html
           from editor_collaboration_documents
          where company_id=$1::uuid and resource_type in ('project','logic_gate') and not is_deleted
       )
       select source.revision::bigint as current_revision,source.canonical_html,
              item.source_revision::bigint as converted_revision,item.source_html_sha256
         from source
         join editor_rollout_gates gate
           on gate.company_id=source.company_id and gate.owner_type=source.resource_type
         left join editor_conversion_items item
           on item.conversion_run_id=gate.validation_run_id
          and item.company_id=source.company_id
          and item.owner_type=source.resource_type
          and item.owner_id=source.resource_id
          and item.document_id=source.document_id`,
      [args.companyID],
    );
    const expectedRows = await client.query(
      "select coalesce(sum(expected_count),0)::bigint as expected_count from editor_rollout_gates where company_id=$1::uuid and owner_type=any($2::text[]) and rollout_state='ready'",
      [args.companyID, OWNER_TYPES],
    );
    const sourceDrift = sourceRows.rows.some((row) =>
      row.converted_revision === null
      || Number(row.current_revision) !== Number(row.converted_revision)
      || sha256(String(row.canonical_html)) !== row.source_html_sha256
    );
    if (sourceRows.rowCount !== Number(expectedRows.rows[0].expected_count) || sourceDrift) {
      throw new Error("legacy_source_changed_after_validation");
    }    const gates = await client.query(
      `select count(*)::integer as count,coalesce(sum(expected_count),0)::bigint as expected,coalesce(sum(converted_count),0)::bigint as converted
       from editor_rollout_gates where company_id=$1::uuid and owner_type=any($2::text[]) and rollout_state='ready'
       and expected_count=converted_count and failed_count=0 and shadow_mismatch_count=0`,
      [args.companyID, OWNER_TYPES],
    );
    if (Number(gates.rows[0].count) !== 3) throw new Error("all_owner_rollout_gates_must_be_ready");
    await client.query(
      `insert into workspace_editor_formats(company_id,editor_format,migration_state,document_schema_version,expected_document_count,converted_document_count,validated_timestamp,cutover_timestamp)
       values($1::uuid,'tiptap_json','ready',1,$2,$3,clock_timestamp(),clock_timestamp())
       on conflict(company_id) do update set editor_format='tiptap_json',migration_state='ready',
       expected_document_count=excluded.expected_document_count,converted_document_count=excluded.converted_document_count,
       validated_timestamp=excluded.validated_timestamp,cutover_timestamp=excluded.cutover_timestamp`,
      [args.companyID, gates.rows[0].expected, gates.rows[0].converted],
    );
    await client.query("update editor_rollout_gates set rollout_state='active',activated_timestamp=clock_timestamp(),updated_timestamp=clock_timestamp() where company_id=$1::uuid", [args.companyID]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function rollbackExport(client: pg.PoolClient, args: Arguments): Promise<void> {
  await ensureRun(client, { ...args, owners: ["node"] }, 0);
  const extensions = createMangoTiptapExtensions({ editable: false });
  for (const owner of args.owners) {
    const query = owner === "node"
      ? "select node_id::text as owner_id,textbox_id::text as document_id,content_revision as revision,latest_update_sequence,materialized_through_sequence,document_json,deleted_timestamp is not null as is_deleted from node_textboxes where company_id=$1::uuid"
      : owner === "project"
        ? "select project_id::text as owner_id,document_id,revision,null::bigint as latest_update_sequence,null::bigint as materialized_through_sequence,document_json,is_deleted from project_editor_documents where company_id=$1::uuid"
        : "select logic_gate_id::text as owner_id,document_id,revision,null::bigint as latest_update_sequence,null::bigint as materialized_through_sequence,document_json,is_deleted from logic_gate_editor_documents where company_id=$1::uuid";
    const rows = await client.query(query, [args.companyID]);
    for (const row of rows.rows) {
      if (owner === "node" && Number(row.latest_update_sequence) !== Number(row.materialized_through_sequence)) {
        throw new Error(`node_not_materialized:${row.owner_id}:${row.document_id}`);
      }
      const validation = validateMangoTiptapDocument(row.document_json);
      if (!validation.valid) throw new Error(validation.error);
      const html = `<!-- mango-editor-html-v1 -->${generateHTML(validation.value.document, extensions)}`;
      await client.query(
        `insert into editor_rollback_exports(
         rollback_export_id,company_id,owner_type,owner_id,document_id,source_revision,source_update_sequence,
         source_is_deleted,source_json_sha256,exported_html,exported_html_sha256,export_run_id
         ) values($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12::uuid)
         on conflict(company_id,owner_type,owner_id,document_id,source_revision) do nothing`,
        [randomUUID(), args.companyID, owner, row.owner_id, row.document_id, Number(row.revision), row.latest_update_sequence, Boolean(row.is_deleted), sha256(stableJSON(validation.value)), html, sha256(html), args.runID],
      );
    }
  }
  await client.query("update editor_rollout_gates set rollback_export_completed_timestamp=clock_timestamp(),updated_timestamp=clock_timestamp() where company_id=$1::uuid and owner_type=any($2::text[])", [args.companyID, args.owners]);
}

async function rollback(client: pg.PoolClient, args: Arguments): Promise<void> {
  if (args.owners.length !== 3) throw new Error("rollback is company-wide and requires --owner all");
  await client.query("begin");
  try {
    await client.query(
      "update editor_rollout_gates set rollout_state='rollback_pending',rollback_requested_timestamp=clock_timestamp(),updated_timestamp=clock_timestamp() where company_id=$1::uuid and rollout_state='active'",
      [args.companyID],
    );
    const coverage = await client.query(
      `select count(*)::integer as count from editor_rollout_gates
       where company_id=$1::uuid and owner_type=any($2::text[]) and rollout_state in ('active','rollback_pending')
       and rollback_export_completed_timestamp is not null`,
      [args.companyID, OWNER_TYPES],
    );
    if (Number(coverage.rows[0].count) !== 3) throw new Error("current_rollback_export_required");
    const missingExports = await client.query(
      `with current_documents as (
         select 'node'::text as owner_type,node_id as owner_id,textbox_id::text as document_id,content_revision as revision,latest_update_sequence as update_sequence
           from node_textboxes where company_id=$1::uuid and deleted_timestamp is null
         union all
         select 'project',project_id,document_id,revision,null::bigint from project_editor_documents where company_id=$1::uuid
         union all
         select 'logic_gate',logic_gate_id,document_id,revision,null::bigint from logic_gate_editor_documents where company_id=$1::uuid
       )
       select count(*)::bigint as count from current_documents current_document
        where not exists (
          select 1 from editor_rollback_exports export
           where export.company_id=$1::uuid and export.owner_type=current_document.owner_type
             and export.owner_id=current_document.owner_id and export.document_id=current_document.document_id
             and export.source_revision=current_document.revision
             and export.source_update_sequence is not distinct from current_document.update_sequence
        )`,
      [args.companyID],
    );
    if (Number(missingExports.rows[0].count) !== 0) throw new Error("current_rollback_export_does_not_cover_all_documents");

    await client.query(
      "update workspace_editor_formats set editor_format='legacy_html',migration_state='validated',cutover_timestamp=null,updated_timestamp=clock_timestamp() where company_id=$1::uuid",
      [args.companyID],
    );await client.query(
      `update editor_collaboration_documents legacy set
       canonical_html=export.exported_html,is_deleted=export.source_is_deleted,
       revision=legacy.revision+1,updated_timestamp=clock_timestamp()
       from (
         select distinct on(owner_type,owner_id,document_id) owner_type,owner_id,document_id,exported_html,source_is_deleted
         from editor_rollback_exports where company_id=$1::uuid
         order by owner_type,owner_id,document_id,source_revision desc
       ) export
       where legacy.company_id=$1::uuid and legacy.resource_type=export.owner_type
         and legacy.resource_id=export.owner_id and legacy.document_id::text=export.document_id`,
      [args.companyID],
    );

    await client.query(
      `insert into editor_collaboration_documents(
         company_id,resource_type,resource_id,document_id,revision,canonical_html,is_deleted,created_timestamp,updated_timestamp
       )
       select export.company_id,export.owner_type,export.owner_id,export.document_id::uuid,
              export.source_revision,export.exported_html,export.source_is_deleted,clock_timestamp(),clock_timestamp()
       from (
         select distinct on(owner_type,owner_id,document_id)
                company_id,owner_type,owner_id,document_id,source_revision,exported_html,source_is_deleted
         from editor_rollback_exports where company_id=$1::uuid
         order by owner_type,owner_id,document_id,source_revision desc
       ) export
       where not exists (
         select 1 from editor_collaboration_documents legacy
         where legacy.company_id=export.company_id and legacy.resource_type=export.owner_type
           and legacy.resource_id=export.owner_id and legacy.document_id::text=export.document_id
       )`,
      [args.companyID],
    );

    await client.query(
      "update editor_rollout_gates set rollout_state='rolled_back',rolled_back_timestamp=clock_timestamp(),updated_timestamp=clock_timestamp() where company_id=$1::uuid",
      [args.companyID],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  assertWriteSafety(args);
  const databaseURL = String(process.env.MANGORTS_MIGRATION_DATABASE_URL || "").trim();
  if (!databaseURL) throw new Error("MANGORTS_MIGRATION_DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseURL, max: 2, application_name: "mangorts-editor-migration" });
  const client = await pool.connect();
  try {
    if (!args.allowWrite) await client.query("begin read only");
    if (["inventory", "dry-run", "backfill"].includes(args.mode)) await runConversion(client, args);
    else if (args.mode === "shadow") await shadowValidate(client, args);
    else if (args.mode === "readiness") await validateReadiness(client, args);
    else if (args.mode === "activate") await activate(client, args);
    else if (args.mode === "rollback-export") await rollbackExport(client, args);
    else if (args.mode === "rollback") await rollback(client, args);
    if (!args.allowWrite) await client.query("rollback");
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "unknown migration failure"}\n`);
  process.exitCode = 1;
});
