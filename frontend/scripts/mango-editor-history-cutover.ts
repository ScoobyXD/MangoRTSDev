import process from "node:process";
import { Client, type ClientConfig } from "pg";
import {
  convertActiveHistoryRows,
  convertRecyclePayload,
  type JSONRecord,
  type RecycleConversionStats,
} from "./mango-editor-history-cutover-core.js";
import type { MangoLegacyAttachmentMetadata } from "./mango-html-to-json-core.js";

type Arguments = {
  companyID: string;
  apply: boolean;
  allowWrite: boolean;
  confirmDatabase: string;
  confirmCompanyID: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  sslMode: string;
};

type RecycleItem = {
  company_id: string;
  recycle_bin_item_id: string;
  restore_payload: JSONRecord;
};

function argumentValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function parseArguments(argv: string[]): Arguments {
  const portText = argumentValue(argv, "--port") ?? process.env.PGPORT ?? process.env.DB_PORT;
  const port = portText ? Number.parseInt(portText, 10) : undefined;
  if (port !== undefined && (!Number.isSafeInteger(port) || port <= 0)) throw new Error("--port must be a positive integer.");
  const companyID = argumentValue(argv, "--company-id")?.trim() ?? "";
  if (!companyID) throw new Error("Missing --company-id.");
  return {
    companyID,
    apply: argv.includes("--apply"),
    allowWrite: argv.includes("--allow-write"),
    confirmDatabase: argumentValue(argv, "--confirm-database") ?? "",
    confirmCompanyID: argumentValue(argv, "--confirm-company-id") ?? "",
    host: argumentValue(argv, "--host") ?? process.env.PGHOST ?? process.env.DB_HOST,
    port,
    database: argumentValue(argv, "--database") ?? process.env.PGDATABASE ?? process.env.DB_NAME,
    user: argumentValue(argv, "--user") ?? process.env.PGUSER ?? process.env.DB_USER,
    sslMode: argumentValue(argv, "--sslmode") ?? process.env.PGSSLMODE ?? process.env.DB_SSLMODE ?? "require",
  };
}

function clientConfig(args: Arguments): ClientConfig {
  return {
    host: args.host,
    port: args.port,
    database: args.database,
    user: args.user,
    password: process.env.PGPASSWORD ?? process.env.DB_PASSWORD,
    application_name: args.apply ? "mangorts_editor_history_cutover_apply" : "mangorts_editor_history_cutover_readonly",
    ssl: args.sslMode === "disable" ? false : { rejectUnauthorized: false },
  };
}

function payloadRows(payload: JSONRecord, key: string): JSONRecord[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((row): row is JSONRecord => !!row && typeof row === "object" && !Array.isArray(row)) : [];
}

function hasTextboxCutoverData(payload: JSONRecord): boolean {
  const projectionKeys = ["node_projection_table", "logic_gate_projection_table", "project_projection_table"];
  if (projectionKeys.some((key) => payloadRows(payload, key).some((row) => row.type === "Text box"))) return true;
  if (payloadRows(payload, "node_information").some((row) => typeof row.save_batch_id === "string" && row.save_batch_id)) return true;
  if (payloadRows(payload, "logic_gate_information").some((row) => typeof row.save_batch_id === "string" && row.save_batch_id)) return true;
  if (payloadRows(payload, "project_information").some((row) => row.type === "Saved version")) return true;
  return ["node_textboxes", "project_textboxes", "logic_gate_textboxes", "node_textboxes_history", "project_textboxes_history", "logic_gate_textboxes_history"]
    .some((key) => payloadRows(payload, key).length > 0);
}

function addStats(target: RecycleConversionStats, source: RecycleConversionStats): void {
  for (const key of Object.keys(target) as Array<keyof RecycleConversionStats>) target[key] += source[key];
}

function emptyStats(): RecycleConversionStats {
  return { nodeCurrent: 0, projectCurrent: 0, logicGateCurrent: 0, nodeHistory: 0, projectHistory: 0, logicGateHistory: 0, automaticHistoryDiscarded: 0 };
}

function nodeOwnerKeys(item: RecycleItem): string[] {
  return payloadRows(item.restore_payload, "nodes").map((row) => {
    const companyID = typeof row.company_id === "string" ? row.company_id : item.company_id;
    const nodeID = typeof row.node_id === "string" ? row.node_id : "";
    return nodeID ? `${companyID}|${nodeID}` : "";
  }).filter(Boolean);
}

async function assertNoHistoryConflicts(client: Client, table: "node_textboxes_history" | "logic_gate_textboxes_history", converted: JSONRecord[]): Promise<void> {
  if (converted.length === 0) return;
  const ownerColumn = table === "node_textboxes_history" ? "node_id" : "logic_gate_id";
  const displayCheck = table === "node_textboxes_history" ? "or target.display_order is distinct from source.display_order" : "";
  const result = await client.query<{ conflicts: string }>(`select count(*)::text conflicts
    from jsonb_to_recordset($1::jsonb) source(
      company_id text,${ownerColumn} text,textbox_id text,batch_id text,body_json jsonb,
      display_order bigint,saved_by_user_id text,saved_timestamp timestamptz
    )
    join ${table} target
      on target.company_id=source.company_id::uuid
     and target.${ownerColumn}=source.${ownerColumn}::uuid
     and target.textbox_id::text=source.textbox_id
     and target.batch_id=source.batch_id::uuid
   where target.body_json is distinct from source.body_json
      or coalesce(target.saved_by_user_id::text,'') is distinct from coalesce(source.saved_by_user_id,'')
      or target.saved_timestamp is distinct from source.saved_timestamp
      ${displayCheck}`, [JSON.stringify(converted)]);
  if (result.rows[0]?.conflicts !== "0") throw new Error(`${table} already contains conflicting converted rows.`);
}

async function insertHistory(client: Client, table: "node_textboxes_history" | "logic_gate_textboxes_history", converted: JSONRecord[]): Promise<number> {
  if (converted.length === 0) return 0;
  await assertNoHistoryConflicts(client, table, converted);
  if (table === "node_textboxes_history") {
    const result = await client.query(`insert into node_textboxes_history(
        company_id,node_id,textbox_id,batch_id,body_json,display_order,saved_by_user_id,saved_timestamp
      ) select company_id::uuid,node_id::uuid,textbox_id::uuid,batch_id::uuid,body_json,display_order,
               nullif(saved_by_user_id,'')::uuid,saved_timestamp
        from jsonb_to_recordset($1::jsonb) source(
          company_id text,node_id text,textbox_id text,batch_id text,body_json jsonb,
          display_order bigint,saved_by_user_id text,saved_timestamp timestamptz
        ) on conflict(company_id,node_id,batch_id,textbox_id) do nothing`, [JSON.stringify(converted)]);
    return result.rowCount ?? 0;
  }
  const result = await client.query(`insert into logic_gate_textboxes_history(
      company_id,logic_gate_id,textbox_id,batch_id,body_json,saved_by_user_id,saved_timestamp
    ) select company_id::uuid,logic_gate_id::uuid,textbox_id,batch_id::uuid,body_json,
             nullif(saved_by_user_id,'')::uuid,saved_timestamp
      from jsonb_to_recordset($1::jsonb) source(
        company_id text,logic_gate_id text,textbox_id text,batch_id text,body_json jsonb,
        display_order bigint,saved_by_user_id text,saved_timestamp timestamptz
      ) on conflict(company_id,logic_gate_id,batch_id,textbox_id) do nothing`, [JSON.stringify(converted)]);
  return result.rowCount ?? 0;
}

async function run(args: Arguments): Promise<void> {
  if (args.apply && (!args.allowWrite || !args.confirmDatabase || args.confirmCompanyID !== args.companyID)) {
    throw new Error("Apply requires --allow-write, --confirm-database, and an exact matching --confirm-company-id.");
  }
  const client = new Client(clientConfig(args));
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query(args.apply ? "begin isolation level serializable" : "begin isolation level repeatable read read only");
    transactionOpen = true;
    await client.query("set local statement_timeout='120s'");
    if (args.apply) await client.query("select pg_advisory_xact_lock(hashtextextended('mangorts-editor-textbox-history-cutover',0))");
    const boundary = await client.query<{
      role_name: string;
      database_name: string;
      read_only: string;
      can_insert_history: boolean;
      can_update_recycle: boolean;
    }>(`select current_user role_name,current_database() database_name,
          current_setting('transaction_read_only') read_only,
          has_table_privilege(current_user,'node_textboxes_history','INSERT') can_insert_history,
          has_table_privilege(current_user,'recycle_bin_items','UPDATE') can_update_recycle`);
    const access = boundary.rows[0];
    if (!args.apply && (access.read_only !== "on" || access.can_insert_history || access.can_update_recycle)) {
      throw new Error(`Dry-run must use the designated database-enforced read-only role; connected as ${access.role_name}.`);
    }
    if (args.apply) {
      if (access.database_name !== args.confirmDatabase) throw new Error(`Database confirmation does not match ${access.database_name}.`);
      if (access.read_only === "on" || !access.can_insert_history || !access.can_update_recycle) {
        throw new Error("Apply connection cannot insert history and update recycle payloads.");
      }
    }

    const [nodeSource, logicSource, recycleResult, orphanResult, attachmentResult] = await Promise.all([
      client.query<{ source: JSONRecord }>(`select to_jsonb(source) source from (
        select company_id::text,node_id::text,information_id::text,coalesce(source_information_id::text,'') source_information_id,
               save_batch_id::text,save_kind,coalesce(saved_by_user_id::text,'') saved_by_user_id,
               information,created_timestamp,updated_timestamp
          from node_information where company_id=$1::uuid and save_batch_id is not null
         order by node_id,save_batch_id,created_timestamp,information_id
      ) source`, [args.companyID]),
      client.query<{ source: JSONRecord }>(`select to_jsonb(source) source from (
        select company_id::text,logic_gate_id::text,information_id::text,coalesce(source_information_id::text,'') source_information_id,
               save_batch_id::text,save_kind,coalesce(saved_by_user_id::text,'') saved_by_user_id,
               information,created_timestamp,updated_timestamp
          from logic_gate_information where company_id=$1::uuid and save_batch_id is not null
         order by logic_gate_id,save_batch_id,created_timestamp,information_id
      ) source`, [args.companyID]),
      client.query<RecycleItem>(`select company_id::text,recycle_bin_item_id::text,restore_payload
        from recycle_bin_items where company_id=$1::uuid order by recycle_bin_item_id${args.apply ? " for update" : ""}`, [args.companyID]),
      client.query<{ source: JSONRecord }>(`select to_jsonb(source) source from (
        select document.company_id::text,document.resource_id,document.document_id,document.revision,
               document.canonical_document,document.canonical_annotations,document.is_deleted,
               document.created_timestamp,document.updated_timestamp
          from editor_json_documents document
          left join nodes parent on parent.company_id=document.company_id and parent.node_id=document.resource_id::uuid
         where document.company_id=$1::uuid and document.resource_type='node' and parent.node_id is null
         order by document.resource_id,document.created_timestamp,document.document_id
      ) source`, [args.companyID]),
      client.query<{ source: MangoLegacyAttachmentMetadata }>(`select to_jsonb(source) source from (
        select attachment.attachment_id::text "attachmentId",
               coalesce(resource.resource_attachment_id::text,'') "sourceResourceAttachmentId",
               attachment.original_filename filename,attachment.mime_type "mimeType",
               attachment.byte_size::double precision "byteSize",attachment.sha256,
               attachment.original_width width,attachment.original_height height,
               coalesce(resource.relationship_kind,'') "relationshipKind"
          from attachments attachment
          left join resource_attachments resource
            on resource.company_id=attachment.company_id and resource.attachment_id=attachment.attachment_id
         where attachment.company_id=$1::uuid
         order by attachment.attachment_id,resource.resource_attachment_id
      ) source`, [args.companyID]),
    ]);

    const attachments = attachmentResult.rows.map((row) => row.source);
    const activeAutomaticHistory = [...nodeSource.rows, ...logicSource.rows]
      .filter((row) => String(row.source.save_kind).trim().toLowerCase() === "auto").length;
    const nodeHistory = convertActiveHistoryRows("node", nodeSource.rows.map((row) => row.source), attachments);
    const logicHistory = convertActiveHistoryRows("logic_gate", logicSource.rows.map((row) => row.source), attachments);
    const items = recycleResult.rows;
    const itemByNode = new Map<string, number>();
    items.forEach((item, index) => {
      for (const key of nodeOwnerKeys(item)) {
        if (itemByNode.has(key)) throw new Error(`More than one recycle item contains Node ${key}.`);
        itemByNode.set(key, index);
      }
    });
    const orphanByItem = new Map<number, JSONRecord[]>();
    let permanentOrphanDocuments = 0;
    for (const row of orphanResult.rows.map((result) => result.source)) {
      const key = `${String(row.company_id)}|${String(row.resource_id)}`;
      const itemIndex = itemByNode.get(key);
      if (itemIndex === undefined) {
        permanentOrphanDocuments += 1;
        continue;
      }
      const current = orphanByItem.get(itemIndex) ?? [];
      current.push(row);
      orphanByItem.set(itemIndex, current);
    }

    const recycleStats = emptyStats();
    const convertedItems: Array<{ item: RecycleItem; payload: JSONRecord }> = [];
    items.forEach((item, index) => {
      const orphanDocuments = orphanByItem.get(index) ?? [];
      if (!hasTextboxCutoverData(item.restore_payload) && orphanDocuments.length === 0) return;
      const converted = convertRecyclePayload(item.restore_payload, orphanDocuments, attachments);
      addStats(recycleStats, converted.stats);
      convertedItems.push({ item, payload: converted.payload });
    });

    let nodeInserted = 0;
    let logicInserted = 0;
    if (args.apply) {
      nodeInserted = await insertHistory(client, "node_textboxes_history", nodeHistory);
      logicInserted = await insertHistory(client, "logic_gate_textboxes_history", logicHistory);
      for (const converted of convertedItems) {
        const update = await client.query(`update recycle_bin_items set restore_payload=$3::jsonb
          where company_id=$1::uuid and recycle_bin_item_id=$2::uuid and restore_payload=$4::jsonb`, [
          converted.item.company_id,
          converted.item.recycle_bin_item_id,
          JSON.stringify(converted.payload),
          JSON.stringify(converted.item.restore_payload),
        ]);
        if (update.rowCount !== 1) throw new Error("A recycle payload changed during conversion; transaction was rolled back.");
      }
      await client.query("commit");
      transactionOpen = false;
    } else {
      await client.query("rollback");
      transactionOpen = false;
    }

    console.log(`${args.apply ? "Applied" : "Dry-run passed"}: every selected HTML/JSON document passed Mango validation and text-preservation checks.`);
    console.log(`Active manual history rows: Node ${nodeHistory.length}; Logic Gate ${logicHistory.length}.`);
    console.log(`Recycle items prepared: ${convertedItems.length}.`);
    console.log(`Recycle current textboxes: Node ${recycleStats.nodeCurrent}; Project ${recycleStats.projectCurrent}; Logic Gate ${recycleStats.logicGateCurrent}.`);
    console.log(`Recycle manual history rows: Node ${recycleStats.nodeHistory}; Project ${recycleStats.projectHistory}; Logic Gate ${recycleStats.logicGateHistory}.`);
    console.log(`Automatic snapshots intentionally excluded: ${activeAutomaticHistory + recycleStats.automaticHistoryDiscarded}.`);
    console.log(`Unreachable documents with no recycle item (cleanup candidates): ${permanentOrphanDocuments}.`);
    if (args.apply) console.log(`New active history rows inserted: Node ${nodeInserted}; Logic Gate ${logicInserted}.`);
    else console.log("No database rows were changed.");
  } finally {
    if (transactionOpen) await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

run(parseArguments(process.argv.slice(2))).catch((cause: unknown) => {
  console.error(`Editor history cutover failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = 1;
});
