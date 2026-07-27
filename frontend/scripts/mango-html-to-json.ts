import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { Client, type ClientConfig } from "pg";
import { convertMangoLegacyHTML, mapMangoQuoteAnnotations, type MangoHTMLConversionResult, type MangoMappedAnnotation } from "./mango-html-to-json-core.js";

type Arguments = {
  companyID: string;
  nodeID: string;
  documentID: string;
  outputDir: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  sslMode: string;
};

type SourceRow = {
  company_id: string;
  resource_type: string;
  resource_id: string;
  document_id: string;
  revision: string;
  canonical_html: string;
  updated_timestamp: Date | string;
};

type CommentRow = {
  information_id: string;
  parent_id: string;
  selection_start: string | null;
  selection_end: string | null;
  selection_quote: string;
};

function argumentValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function requiredArgument(argv: string[], name: string): string {
  const value = argumentValue(argv, name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function parseArguments(argv: string[]): Arguments {
  const outputDir = argumentValue(argv, "--output-dir")
    ?? resolve(tmpdir(), "mangorts-html-to-json-output");
  const portText = argumentValue(argv, "--port") ?? process.env.PGPORT;
  const parsedPort = portText ? Number.parseInt(portText, 10) : undefined;
  if (parsedPort !== undefined && (!Number.isInteger(parsedPort) || parsedPort <= 0)) {
    throw new Error("--port must be a positive integer.");
  }
  return {
    companyID: requiredArgument(argv, "--company-id"),
    nodeID: requiredArgument(argv, "--node-id"),
    documentID: requiredArgument(argv, "--document-id"),
    outputDir,
    host: argumentValue(argv, "--host") ?? process.env.PGHOST,
    port: parsedPort,
    database: argumentValue(argv, "--database") ?? process.env.PGDATABASE,
    user: argumentValue(argv, "--user") ?? process.env.PGUSER,
    sslMode: argumentValue(argv, "--sslmode") ?? process.env.PGSSLMODE ?? "require",
  };
}

function clientConfig(args: Arguments): ClientConfig {
  return {
    host: args.host,
    port: args.port,
    database: args.database,
    user: args.user,
    password: process.env.PGPASSWORD,
    application_name: "mangorts_html_to_json_readonly",
    ssl: args.sslMode === "disable" ? false : { rejectUnauthorized: false },
  };
}

function sqlTextLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function jsonDollarQuote(value: string, sourceHash: string): string {
  const tag = `mango_json_${sourceHash.slice(0, 12)}`;
  const delimiter = `$${tag}$`;
  if (value.includes(delimiter)) throw new Error("Generated JSON unexpectedly contains its SQL delimiter.");
  return `${delimiter}${value}${delimiter}`;
}

function buildInsertSQL(source: SourceRow, converted: MangoHTMLConversionResult, annotations: readonly MangoMappedAnnotation[]): string {
  const canonical = JSON.stringify(converted.document);
  const company = sqlTextLiteral(source.company_id);
  const resourceType = sqlTextLiteral(source.resource_type);
  const resourceID = sqlTextLiteral(source.resource_id);
  const documentID = sqlTextLiteral(source.document_id);
  const sourceMD5 = sqlTextLiteral(converted.sourceMD5);
  const json = jsonDollarQuote(canonical, converted.sourceSHA256);
  const annotationJSON = jsonDollarQuote(JSON.stringify(annotations), converted.sourceSHA256);
  return `\\set ON_ERROR_STOP on
-- This inserts one converted JSON document. It does NOT enable JSON mode.
-- The current site will keep reading legacy HTML until a separate, company-wide cutover is approved.
begin;

do $mango_guard$
declare
  current_revision bigint;
  current_source_md5 text;
begin
  select revision, md5(canonical_html)
    into current_revision, current_source_md5
  from editor_collaboration_documents
  where company_id = ${company}::uuid
    and resource_type = ${resourceType}
    and resource_id = ${resourceID}
    and document_id = ${documentID}
    and not is_deleted
  for share;

  if current_revision is null then
    raise exception 'Source textbox was not found or is deleted';
  end if;
  if current_revision <> ${source.revision} then
    raise exception 'Source revision changed: expected %, found %', ${source.revision}, current_revision;
  end if;
  if current_source_md5 <> ${sourceMD5} then
    raise exception 'Source HTML changed after conversion';
  end if;
  if exists (
    select 1 from workspace_editor_formats
    where company_id = ${company}::uuid
      and (editor_format <> 'legacy_html' or migration_state <> 'not_started')
  ) then
    raise exception 'Workspace editor migration is already active; refusing one-document trial insert';
  end if;

  if exists (
    select 1 from editor_json_documents
    where company_id = ${company}::uuid
      and resource_type = ${resourceType}
      and resource_id = ${resourceID}
      and document_id = ${documentID}
  ) then
    raise exception 'A JSON row already exists for this textbox; refusing to overwrite it';
  end if;
end
$mango_guard$;

insert into editor_json_documents (
  company_id, resource_type, resource_id, document_id,
  document_schema_version, revision, canonical_document,
  canonical_annotations, is_deleted, created_timestamp, updated_timestamp
) values (
  ${company}::uuid, ${resourceType}, ${resourceID}, ${documentID},
  1, 0, ${json}::jsonb,
  ${annotationJSON}::jsonb, false, now(), now()
);

select company_id, resource_type, resource_id, document_id,
       document_schema_version, revision, is_deleted,
       pg_column_size(canonical_document) as json_bytes
from editor_json_documents
where company_id = ${company}::uuid
  and resource_type = ${resourceType}
  and resource_id = ${resourceID}
  and document_id = ${documentID};

commit;
`;
}

function escapeHTML(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function previewAttachmentPlaceholders(html: string): string {
  return html.replace(/<mango-attachment-image\b([^>]*)><\/mango-attachment-image>|<mango-attachment-image\b([^>]*)\/>/gi, (_match, first, second) => {
    const attributes = String(first || second || "");
    const filename = /data-filename="([^"]*)"/i.exec(attributes)?.[1] || "attached image";
    const attachmentID = /data-attachment-id="([^"]*)"/i.exec(attributes)?.[1] || "unknown";
    return `<figure class="attachment"><strong>Image preserved:</strong> ${escapeHTML(filename)}<br><small>attachment ${escapeHTML(attachmentID)}</small></figure>`;
  });
}

function buildPreviewHTML(source: SourceRow, converted: MangoHTMLConversionResult, commentCount: number, mappedAnchorCount: number): string {
  const counts = escapeHTML(JSON.stringify(converted.jsonCounts, null, 2));
  const body = previewAttachmentPlaceholders(converted.roundTripHTML);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Mango JSON conversion preview</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;margin:28px;color:#172033;background:#f4f6fb}main{max-width:1000px;margin:auto}.card{background:white;border:1px solid #dbe1ec;border-radius:12px;padding:24px;margin:16px 0;box-shadow:0 4px 16px #26334d10}mark{padding:0 2px}table{border-collapse:collapse}td,th{border:1px solid #aeb8c8;padding:6px}.attachment{border:2px dashed #7c8ba6;border-radius:8px;padding:18px;background:#f8fafc}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:22px}.ok{color:#08783f;font-weight:700}
</style></head><body><main>
<h1>Textbox JSON conversion preview</h1>
<div class="card"><div class="ok">Conversion and Mango validation passed</div>
<p>Node: <code>${escapeHTML(source.resource_id)}</code><br>Textbox: <code>${escapeHTML(source.document_id)}</code><br>Source revision: ${escapeHTML(source.revision)}<br>Linked chat/comment records: ${commentCount}<br>Mapped selection highlights: ${mappedAnchorCount}</p></div>
<div class="card"><h2>Rendered from converted JSON</h2>${body}</div>
<div class="card"><h2>Preservation counts</h2><pre>${counts}</pre></div>
</main></body></html>`;
}

async function readAndConvert(args: Arguments): Promise<void> {
  const client = new Client(clientConfig(args));
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("begin isolation level repeatable read read only");
    transactionOpen = true;
    const boundary = await client.query<{
      role_name: string;
      read_only: string;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(`select current_user as role_name,
              current_setting('transaction_read_only') as read_only,
              has_table_privilege(current_user, 'editor_json_documents', 'INSERT') as can_insert,
              has_table_privilege(current_user, 'editor_json_documents', 'UPDATE') as can_update,
              has_table_privilege(current_user, 'editor_json_documents', 'DELETE') as can_delete`);
    const access = boundary.rows[0];
    if (access.read_only !== "on") throw new Error("Database transaction is not read-only.");
    if (access.can_insert || access.can_update || access.can_delete) {
      throw new Error(`Database role ${access.role_name} has write privileges; use the designated read-only credential.`);
    }

    const sourceResult = await client.query<SourceRow>(`select company_id::text, resource_type, resource_id,
          document_id, revision::text, canonical_html, updated_timestamp
        from editor_collaboration_documents
        where company_id=$1::uuid and resource_type='node' and resource_id=$2
          and document_id=$3 and not is_deleted`, [args.companyID, args.nodeID, args.documentID]);
    if (sourceResult.rowCount !== 1) throw new Error("Exactly one live collaboration textbox was not found for those IDs.");
    const source = sourceResult.rows[0];

    const existing = await client.query(`select 1 from editor_json_documents
      where company_id=$1::uuid and resource_type='node' and resource_id=$2 and document_id=$3`,
    [args.companyID, args.nodeID, args.documentID]);
    if ((existing.rowCount ?? 0) > 0) throw new Error("A JSON row already exists for this textbox; refusing to prepare overwrite SQL.");

    const comments = await client.query<CommentRow>(`select information_id::text,
          coalesce(information::jsonb->>'parent_id','') as parent_id,
          information::jsonb->>'selection_start' as selection_start,
          information::jsonb->>'selection_end' as selection_end,
          coalesce(information::jsonb->>'selection_quote','') as selection_quote
        from node_projection_table
        where company_id=$1::uuid and node_id=$2::uuid and type='Text block chat'
          and not is_deleted and information::jsonb->>'block_id'=$3
        order by created_timestamp, information_id`, [args.companyID, args.nodeID, args.documentID]);

    const gate = await client.query(`select editor_format, migration_state,
          expected_document_count, converted_document_count
        from workspace_editor_formats where company_id=$1::uuid`, [args.companyID]);
    const gateRow = gate.rows[0] as { editor_format?: string; migration_state?: string } | undefined;
    if (gateRow && (gateRow.editor_format !== "legacy_html" || gateRow.migration_state !== "not_started")) {
      throw new Error("Workspace editor migration is already active; refusing a one-document trial.");
    }

    const converted = convertMangoLegacyHTML(source.canonical_html);
    const selectedChats = comments.rows.filter((comment) => comment.selection_quote.trim());
    const mapped = mapMangoQuoteAnnotations(converted.document, selectedChats.map((comment) => ({
      id: comment.information_id,
      quote: comment.selection_quote,
    })));
    if (mapped.unmappedIDs.length > 0) {
      throw new Error(`Refusing to generate SQL because ${mapped.unmappedIDs.length} comment selection anchor(s) could not be mapped uniquely.`);
    }
    converted.warnings.push(`${comments.rowCount ?? 0} chat/comment message records remain separate; ${mapped.annotations.length} selection positions were mapped into canonical_annotations.`);
    converted.warnings.push("The SQL stores one JSON row but does not enable JSON mode for the company.");

    const report = {
      success: true,
      converter: "@tiptap/html/server generateJSON with Mango's current Tiptap extensions",
      databaseAccess: { role: access.role_name, transactionReadOnly: true, roleHasWritePrivileges: false },
      source: {
        companyID: source.company_id,
        resourceType: source.resource_type,
        nodeID: source.resource_id,
        documentID: source.document_id,
        revision: Number(source.revision),
        updatedTimestamp: source.updated_timestamp,
        sha256: converted.sourceSHA256,
        md5: converted.sourceMD5,
      },
      editorGate: gate.rows[0] ?? { editor_format: "legacy_html", migration_state: "not_started", note: "No gate row; backend defaults apply." },
      textPreserved: true,
      sourceCounts: converted.sourceCounts,
      jsonCounts: converted.jsonCounts,
      mappedAnnotations: mapped.annotations,
      linkedChats: comments.rows.map((comment) => ({
        informationID: comment.information_id,
        parentID: comment.parent_id || null,
        selectionStart: comment.selection_start === null ? null : Number(comment.selection_start),
        selectionEnd: comment.selection_end === null ? null : Number(comment.selection_end),
        selectionQuote: comment.selection_quote,
      })),
      warnings: converted.warnings,
    };

    await mkdir(args.outputDir, { recursive: true });
    const base = `${source.resource_id}-${source.document_id}`;
    const jsonPath = resolve(args.outputDir, `${base}.json`);
    const reportPath = resolve(args.outputDir, `${base}.report.json`);
    const previewPath = resolve(args.outputDir, `${base}.preview.html`);
    const sqlPath = resolve(args.outputDir, `${base}.insert.sql`);
    await Promise.all([
      writeFile(jsonPath, `${JSON.stringify(converted.document, null, 2)}\n`, "utf8"),
      writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
      writeFile(previewPath, buildPreviewHTML(source, converted, comments.rowCount ?? 0, mapped.annotations.length), "utf8"),
      writeFile(sqlPath, buildInsertSQL(source, converted, mapped.annotations), "utf8"),
    ]);
    await client.query("rollback");
    transactionOpen = false;

    console.log("Conversion passed: visible text and supported rich-text structures were preserved.");
    console.log(`Read-only database role: ${access.role_name}`);
    console.log(`Linked chat/comment records: ${comments.rowCount ?? 0}; mapped selection highlights: ${mapped.annotations.length}`);
    console.log(`JSON: ${jsonPath}`);
    console.log(`Report: ${reportPath}`);
    console.log(`Preview: ${previewPath}`);
    console.log(`Copy/paste SQL: ${sqlPath}`);
    console.log("The SQL does not enable JSON mode, so inserting it alone will not change what the normal site displays.");
  } finally {
    if (transactionOpen) await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

readAndConvert(parseArguments(process.argv.slice(2))).catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error(`Conversion failed: ${message}`);
  process.exitCode = 1;
});
