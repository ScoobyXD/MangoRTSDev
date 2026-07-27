import React from "react";
import type { JSONContent } from "@tiptap/core";
import { needsMangoTiptapLegacyDateHeadingBreak, type MangoTiptapDocument } from "./mangoTiptapDocument.js";
import type { MangoTiptapAnnotation } from "./mangoTiptapAnnotations.js";
import { ExplorerEntityIcon } from "../../company-explorer/CompanyExplorerEntityIcon.js";
import { editorEntityRoute, editorEntityTypeLabel, isEditorEntityType, openEditorEntityLink } from "../editorEntityLinks.js";
import "./mangoTiptap.css";

export type MangoStaticAttachmentImageProps = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  width?: number;
  height?: number;
  displayWidth?: number;
  displayHeight?: number;
  alignment?: string;
  position?: string;
  layout?: string;
  alt?: string;
  title?: string;
};

type MangoTiptapStaticRendererProps = {
  value: MangoTiptapDocument;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
  annotations?: readonly MangoTiptapAnnotation[];
  renderAttachmentImage?: (attributes: MangoStaticAttachmentImageProps) => React.ReactNode;
};

function markContent(content: React.ReactNode, mark: NonNullable<JSONContent["marks"]>[number], key: number): React.ReactNode {
  const attrs = mark.attrs ?? {};
  switch (mark.type) {
    case "bold": return <strong key={key}>{content}</strong>;
    case "italic": return <em key={key}>{content}</em>;
    case "underline": return <u key={key}>{content}</u>;
    case "strike": return <s key={key}>{content}</s>;
    case "code": return <code key={key}>{content}</code>;
    case "highlight": return <mark key={key} style={{ backgroundColor: String(attrs.color || "#fff59d") }}>{content}</mark>;
    case "textStyle":
      return <span key={key} style={{ fontSize: attrs.fontSize ? String(attrs.fontSize) : undefined, color: attrs.color ? String(attrs.color) : undefined }}>{content}</span>;
    case "link":
      return <a key={key} href={String(attrs.href || "#")} target={attrs.target ? String(attrs.target) : undefined} rel="noopener noreferrer nofollow">{content}</a>;
    default: return content;
  }
}

function staticNodeSize(node: JSONContent): number {
  if (node.type === "text") return node.text?.length ?? 0;
  if (node.type === "doc") return (node.content ?? []).reduce((total, child) => total + staticNodeSize(child), 0);
  if (["hardBreak", "horizontalRule", "mention", "mangoEntityLink", "mangoAttachmentImage"].includes(node.type ?? "")) return 1;
  return 2 + (node.content ?? []).reduce((total, child) => total + staticNodeSize(child), 0);
}

function annotationClass(annotation: MangoTiptapAnnotation): string {
  return `mango-tiptap-annotation mango-tiptap-annotation--${annotation.kind}${annotation.active ? " is-active" : ""}`;
}

function renderAnnotatedText(node: JSONContent, key: React.Key, position: number, annotations: readonly MangoTiptapAnnotation[]): React.ReactNode {
  const text = node.text ?? "";
  const end = position + text.length;
  const relevant = annotations.filter((annotation) => annotation.from < end && annotation.to > position);
  if (relevant.length === 0) {
    return <React.Fragment key={key}>{(node.marks ?? []).reduce<React.ReactNode>((content, mark, index) => markContent(content, mark, index), text)}</React.Fragment>;
  }
  const boundaries = new Set([position, end]);
  relevant.forEach((annotation) => {
    boundaries.add(Math.max(position, annotation.from));
    boundaries.add(Math.min(end, annotation.to));
  });
  const ordered = [...boundaries].sort((left, right) => left - right);
  return <React.Fragment key={key}>{ordered.slice(0, -1).map((start, index) => {
    const finish = ordered[index + 1];
    let content = (node.marks ?? []).reduce<React.ReactNode>(
      (current, mark, markIndex) => markContent(current, mark, markIndex),
      text.slice(start - position, finish - position),
    );
    const covering = relevant.filter((annotation) => annotation.from < finish && annotation.to > start);
    covering.forEach((annotation) => {
      content = <span className={annotationClass(annotation)} data-mango-annotation-id={annotation.id} data-mango-annotation-kind={annotation.kind}>{content}</span>;
    });
    return <React.Fragment key={`${String(key)}:${start}`}>{content}</React.Fragment>;
  })}</React.Fragment>;
}

function renderChildren(
  node: JSONContent,
  renderAttachmentImage: MangoTiptapStaticRendererProps["renderAttachmentImage"],
  annotations: readonly MangoTiptapAnnotation[],
  position: number,
): React.ReactNode {
  let childPosition = node.type === "doc" ? position : position + 1;
  return node.content?.map((child, index) => {
    const rendered = renderNode(child, `${node.type || "node"}:${index}`, renderAttachmentImage, annotations, childPosition);
    childPosition += staticNodeSize(child);
    return rendered;
  });
}

function renderNode(
  node: JSONContent,
  key: React.Key,
  renderAttachmentImage: MangoTiptapStaticRendererProps["renderAttachmentImage"],
  annotations: readonly MangoTiptapAnnotation[],
  position: number,
): React.ReactNode {
  const attrs = node.attrs ?? {};
  if (node.type === "text") {
    return renderAnnotatedText(node, key, position, annotations);
  }
  const children = renderChildren(node, renderAttachmentImage, annotations, position);
  const blockProps = {
    "data-mango-block-id": attrs.blockId ? String(attrs.blockId) : undefined,
  };
  const style: React.CSSProperties = {
    textAlign: attrs.textAlign as React.CSSProperties["textAlign"],
    marginLeft: attrs.indentLevel ? Number(attrs.indentLevel) * 24 : undefined,
  };
  switch (node.type) {
    case "doc": return <>{children}</>;
    case "paragraph": return <p key={key} {...blockProps} style={style}>{children}</p>;
    case "heading": {
      const level = Math.max(1, Math.min(6, Number(attrs.level) || 1));
      return React.createElement(`h${level}`, { key, ...blockProps, style }, children);
    }
    case "blockquote": return <blockquote key={key} {...blockProps}>{children}</blockquote>;
    case "codeBlock": return <pre key={key} {...blockProps}><code>{children}</code></pre>;
    case "horizontalRule": return <hr key={key} {...blockProps} />;
    case "mangoEntityLink": {
      const entityType = attrs.entityType;
      const entityID = String(attrs.entityId || "");
      const label = String(attrs.label || "Entity");
      if (!isEditorEntityType(entityType) || !entityID) return <span key={key}>{label}</span>;
      return (
        <a
          key={key}
          className={`mango-editor-entity-link mango-editor-entity-link--${entityType}`}
          data-mango-entity-link="true"
          data-mango-entity-type={entityType}
          data-mango-entity-id={entityID}
          data-mango-entity-label={label}
          aria-label={`Open ${editorEntityTypeLabel(entityType)} ${label}`}
          href={editorEntityRoute({ entityType, entityID })}
          onClick={(event) => {
            if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            openEditorEntityLink({ entityType, entityID, label });
          }}
        >
          <ExplorerEntityIcon kind={entityType} className="mango-editor-entity-icon" />
          <span className="mango-editor-entity-label">{label}</span>
        </a>
      );
    }
    case "hardBreak": return <br key={key} />;
    case "bulletList": return <ul key={key} {...blockProps}>{children}</ul>;
    case "orderedList": return <ol key={key} {...blockProps} start={Number(attrs.start) || 1}>{children}</ol>;
    case "listItem": return <li key={key} {...blockProps}>{children}</li>;
    case "taskList": return <ul key={key} {...blockProps} data-type="taskList">{children}</ul>;
    case "taskItem": return (
      <li key={key} {...blockProps} data-type="taskItem" data-checked={Boolean(attrs.checked)}>
        <input type="checkbox" checked={Boolean(attrs.checked)} readOnly tabIndex={-1} aria-hidden="true" /> {children}
      </li>
    );
    case "table": return <table key={key} {...blockProps} style={{ borderCollapse: "collapse", width: "100%", tableLayout: attrs.style === "fixed" ? "fixed" : undefined }}><tbody>{children}</tbody></table>;
    case "tableRow": return <tr key={key}>{children}</tr>;
    case "tableHeader": {
      const width = Array.isArray(attrs.colwidth) && Number(attrs.colwidth[0]) > 0 ? Number(attrs.colwidth[0]) : undefined;
      return <th key={key} colSpan={Number(attrs.colspan) || 1} rowSpan={Number(attrs.rowspan) || 1} style={{ width, textAlign: attrs.align as React.CSSProperties["textAlign"], backgroundColor: attrs.backgroundColor ? String(attrs.backgroundColor) : undefined }}>{children}</th>;
    }
    case "tableCell": {
      const width = Array.isArray(attrs.colwidth) && Number(attrs.colwidth[0]) > 0 ? Number(attrs.colwidth[0]) : undefined;
      return <td key={key} colSpan={Number(attrs.colspan) || 1} rowSpan={Number(attrs.rowspan) || 1} style={{ width, textAlign: attrs.align as React.CSSProperties["textAlign"], backgroundColor: attrs.backgroundColor ? String(attrs.backgroundColor) : undefined }}>{children}</td>;
    }
    case "mention": {
      const kind = attrs.kind === "urgent" ? "urgent" : "normal";
      return <span key={key} className={`mango-tiptap-mention mango-tiptap-mention--${kind}`} data-mango-user-id={String(attrs.userId || "")} data-mango-mention-kind={kind}>{kind === "urgent" ? "!" : "@"}{String(attrs.label || "user")}</span>;
    }
    case "mangoAttachmentImage": {
      const image = {
        attachmentId: String(attrs.attachmentId || ""),
        filename: String(attrs.filename || ""),
        mimeType: String(attrs.mimeType || ""),
        width: typeof attrs.width === "number" ? attrs.width : undefined,
        height: typeof attrs.height === "number" ? attrs.height : undefined,
        displayWidth: typeof attrs.displayWidth === "number" ? attrs.displayWidth : undefined,
        displayHeight: typeof attrs.displayHeight === "number" ? attrs.displayHeight : undefined,
        alignment: typeof attrs.alignment === "string" ? attrs.alignment : undefined,
        position: typeof attrs.position === "string" ? attrs.position : undefined,
        layout: typeof attrs.layout === "string" ? attrs.layout : undefined,
        alt: typeof attrs.alt === "string" ? attrs.alt : undefined,
        title: typeof attrs.title === "string" ? attrs.title : undefined,
      };
      const content = renderAttachmentImage?.(image) ?? <span data-mango-attachment-id={image.attachmentId}>{image.alt || image.filename || "Attached image"}</span>;
      const covering = annotations.filter((item) => item.from <= position && item.to >= position + 1);
      const annotated = covering.reduce<React.ReactNode>((current, annotation) => (
        <div className={annotationClass(annotation)} data-mango-annotation-id={annotation.id} data-mango-annotation-kind={annotation.kind}>{current}</div>
      ), content);
      return <React.Fragment key={key}>{annotated}</React.Fragment>;
    }
    default: return null;
  }
}

export const MangoTiptapStaticRenderer: React.FC<MangoTiptapStaticRendererProps> = ({
  value,
  className,
  style,
  ariaLabel,
  annotations = [],
  renderAttachmentImage,
}) => (
  <div
    className={`mango-tiptap-document mango-tiptap-static-document${className ? ` ${className}` : ""}`}
    style={style}
    aria-label={ariaLabel}
    data-mango-editor-state="sleeping"
    data-mango-legacy-leading-date-heading={needsMangoTiptapLegacyDateHeadingBreak(value) ? "true" : undefined}
  >
    {renderNode(value.document, "document", renderAttachmentImage, annotations, 0)}
  </div>
);
