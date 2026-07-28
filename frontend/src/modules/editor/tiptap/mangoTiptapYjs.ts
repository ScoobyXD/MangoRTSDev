import { getSchema, type JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import type * as Y from "yjs";

import { createMangoTiptapExtensions } from "./mangoTiptapExtensions.js";

export const MANGO_TIPTAP_SCHEMA = getSchema(createMangoTiptapExtensions({ editable: false }));

export function mangoProsemirrorJSONToYDoc(document: JSONContent, field = "default"): Y.Doc {
  return prosemirrorJSONToYDoc(MANGO_TIPTAP_SCHEMA, document, field);
}
