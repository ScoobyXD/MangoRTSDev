import React from "react";
import type { JSONContent } from "@tiptap/core";
import type { MangoTiptapDocument } from "./mangoTiptapDocument.js";

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

function renderChildren(node: JSONContent, renderAttachmentImage: MangoTiptapStaticRendererProps["renderAttachmentImage"]): React.ReactNode {
  return node.content?.map((child, index) => renderNode(child, `${node.type || "node"}:${index}`, renderAttachmentImage));
}

function renderNode(
  node: JSONContent,
  key: React.Key,
  renderAttachmentImage: MangoTiptapStaticRendererProps["renderAttachmentImage"],
): React.ReactNode {
  const attrs = node.attrs ?? {};
  if (node.type === "text") {
    return (node.marks ?? []).reduce<React.ReactNode>((content, mark, index) => markContent(content, mark, index), node.text ?? "");
  }
  const children = renderChildren(node, renderAttachmentImage);
  const blockProps = {
    key,
    "data-mango-block-id": attrs.blockId ? String(attrs.blockId) : undefined,
  };
  const style: React.CSSProperties = {
    textAlign: attrs.textAlign as React.CSSProperties["textAlign"],
    marginLeft: attrs.indentLevel ? Number(attrs.indentLevel) * 24 : undefined,
  };
  switch (node.type) {
    case "doc": return <>{children}</>;
    case "paragraph": return <p {...blockProps} style={style}>{children}</p>;
    case "heading": {
      const level = Math.max(1, Math.min(6, Number(attrs.level) || 1));
      return React.createElement(`h${level}`, { ...blockProps, style }, children);
    }
    case "blockquote": return <blockquote {...blockProps}>{children}</blockquote>;
    case "codeBlock": return <pre {...blockProps}><code>{children}</code></pre>;
    case "horizontalRule": return <hr {...blockProps} />;
    case "hardBreak": return <br key={key} />;
    case "bulletList": return <ul {...blockProps}>{children}</ul>;
    case "orderedList": return <ol {...blockProps} start={Number(attrs.start) || 1}>{children}</ol>;
    case "listItem": return <li {...blockProps}>{children}</li>;
    case "taskList": return <ul {...blockProps} data-type="taskList">{children}</ul>;
    case "taskItem": return (
      <li {...blockProps} data-type="taskItem" data-checked={Boolean(attrs.checked)}>
        <input type="checkbox" checked={Boolean(attrs.checked)} readOnly tabIndex={-1} aria-hidden="true" /> {children}
      </li>
    );
    case "table": return <table {...blockProps} style={{ borderCollapse: "collapse", width: "100%", tableLayout: attrs.style === "fixed" ? "fixed" : undefined }}><tbody>{children}</tbody></table>;
    case "tableRow": return <tr key={key}>{children}</tr>;
    case "tableHeader": {
      const width = Array.isArray(attrs.colwidth) && Number(attrs.colwidth[0]) > 0 ? Number(attrs.colwidth[0]) : undefined;
      return <th key={key} colSpan={Number(attrs.colspan) || 1} rowSpan={Number(attrs.rowspan) || 1} style={{ width, textAlign: attrs.align as React.CSSProperties["textAlign"], backgroundColor: attrs.backgroundColor ? String(attrs.backgroundColor) : undefined }}>{children}</th>;
    }
    case "tableCell": {
      const width = Array.isArray(attrs.colwidth) && Number(attrs.colwidth[0]) > 0 ? Number(attrs.colwidth[0]) : undefined;
      return <td key={key} colSpan={Number(attrs.colspan) || 1} rowSpan={Number(attrs.rowspan) || 1} style={{ width, textAlign: attrs.align as React.CSSProperties["textAlign"], backgroundColor: attrs.backgroundColor ? String(attrs.backgroundColor) : undefined }}>{children}</td>;
    }
    case "mention": return <span key={key} className="mango-tiptap-mention" data-mango-user-id={String(attrs.userId || "")}>@{String(attrs.label || "user")}</span>;
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
      return <React.Fragment key={key}>{renderAttachmentImage?.(image) ?? <span data-mango-attachment-id={image.attachmentId}>{image.alt || image.filename || "Attached image"}</span>}</React.Fragment>;
    }
    default: return null;
  }
}

export const MangoTiptapStaticRenderer: React.FC<MangoTiptapStaticRendererProps> = ({
  value,
  className,
  style,
  ariaLabel,
  renderAttachmentImage,
}) => (
  <div className={className} style={style} aria-label={ariaLabel} data-mango-editor-state="sleeping">
    {renderNode(value.document, "document", renderAttachmentImage)}
  </div>
);
