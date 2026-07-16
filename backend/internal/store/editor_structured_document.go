package store

import (
	"encoding/json"
	stdhtml "html"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"

	qdelta "github.com/fmpwizard/go-quilljs-delta/delta"
	xhtml "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

var editorInlineAttributeNames = map[string]bool{
	"bold": true, "italic": true, "underline": true, "strike": true,
	"highlight": true, "font_size": true, "link": true, "class": true, "span_style": true,
}

var editorBlockAttributeNames = map[string]bool{
	"block": true, "align": true, "margin_left": true, "list": true, "indent": true, "checked": true,
	"table_id": true, "table_row": true, "table_cell": true, "table_header": true, "rowspan": true, "colspan": true,
}

func cloneEditorAttributes(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func cloneEditorOp(input EditorCollaborationOp) EditorCollaborationOp {
	output := input
	output.Attributes = cloneEditorAttributes(input.Attributes)
	if embed, ok := input.Insert.(map[string]any); ok {
		copyEmbed := make(map[string]any, len(embed))
		for key, value := range embed {
			if object, objectOK := value.(map[string]any); objectOK {
				value = cloneEditorAttributes(object)
			}
			copyEmbed[key] = value
		}
		output.Insert = copyEmbed
	}
	return output
}

func appendEditorInsert(ops *[]EditorCollaborationOp, insert any, attributes map[string]any) {
	if text, ok := insert.(string); ok && text == "" {
		return
	}
	if text, ok := insert.(string); ok && len(*ops) > 0 {
		last := &(*ops)[len(*ops)-1]
		if lastText, lastOK := last.Insert.(string); lastOK && reflect.DeepEqual(last.Attributes, attributes) {
			last.Insert = lastText + text
			return
		}
	}
	*ops = append(*ops, EditorCollaborationOp{Insert: insert, Attributes: cloneEditorAttributes(attributes)})
}

func editorUTF16Runes(value string) []rune {
	units := utf16.Encode([]rune(value))
	result := make([]rune, len(units))
	for index, unit := range units {
		result[index] = rune(unit)
	}
	return result
}

func editorStringFromUTF16Runes(value []rune) string {
	units := make([]uint16, len(value))
	for index, unit := range value {
		units[index] = uint16(unit)
	}
	return string(utf16.Decode(units))
}

func editorDeltaToQuill(input EditorCollaborationDelta) qdelta.Delta {
	output := qdelta.Delta{}
	for _, operation := range input.Ops {
		switch insert := operation.Insert.(type) {
		case string:
			output.Push(qdelta.Op{Insert: editorUTF16Runes(insert), Attributes: cloneEditorAttributes(operation.Attributes)})
		case map[string]any:
			for key, value := range insert {
				output.Push(qdelta.Op{InsertEmbed: &qdelta.Embed{Key: key, Value: value}, Attributes: cloneEditorAttributes(operation.Attributes)})
			}
		default:
			if operation.Retain > 0 {
				value := operation.Retain
				output.Push(qdelta.Op{Retain: &value, Attributes: cloneEditorAttributes(operation.Attributes)})
			} else if operation.Delete > 0 {
				value := operation.Delete
				output.Push(qdelta.Op{Delete: &value})
			}
		}
	}
	return output
}

func editorDeltaFromQuill(input *qdelta.Delta) EditorCollaborationDelta {
	output := EditorCollaborationDelta{Ops: make([]EditorCollaborationOp, 0, len(input.Ops))}
	for _, operation := range input.Ops {
		next := EditorCollaborationOp{Attributes: cloneEditorAttributes(operation.Attributes)}
		switch {
		case operation.Insert != nil:
			next.Insert = editorStringFromUTF16Runes(operation.Insert)
		case operation.InsertEmbed != nil:
			next.Insert = map[string]any{operation.InsertEmbed.Key: operation.InsertEmbed.Value}
		case operation.Retain != nil:
			next.Retain = *operation.Retain
		case operation.Delete != nil:
			next.Delete = *operation.Delete
		default:
			continue
		}
		output.Ops = append(output.Ops, next)
	}
	return output
}

func editorStateToDelta(state EditorCollaborationState) EditorCollaborationDelta {
	return EditorCollaborationDelta{Ops: state.Ops}
}

func editorDeltaToState(delta EditorCollaborationDelta) EditorCollaborationState {
	return EditorCollaborationState{Ops: delta.Ops}
}

func ValidateEditorCollaborationState(state EditorCollaborationState) error {
	for _, operation := range state.Ops {
		if operation.Insert == nil || operation.Retain != 0 || operation.Delete != 0 {
			return ErrInvalid
		}
		if err := validateEditorInsert(operation.Insert); err != nil {
			return err
		}
		if err := validateEditorAttributes(operation.Attributes, true); err != nil {
			return err
		}
	}
	return nil
}

func ValidateEditorCollaborationDelta(input EditorCollaborationDelta) error {
	if len(input.Ops) == 0 || len(input.Ops) > EditorCollaborationOperationMaxOpCount {
		return ErrInvalid
	}
	for _, operation := range input.Ops {
		actions := 0
		if operation.Insert != nil {
			actions++
			if err := validateEditorInsert(operation.Insert); err != nil {
				return err
			}
		}
		if operation.Retain > 0 {
			actions++
		}
		if operation.Delete > 0 {
			actions++
		}
		if operation.Retain < 0 || operation.Delete < 0 || actions != 1 {
			return ErrInvalid
		}
		if operation.Delete > 0 && len(operation.Attributes) > 0 {
			return ErrInvalid
		}
		if err := validateEditorAttributes(operation.Attributes, false); err != nil {
			return err
		}
	}
	return nil
}

func validateEditorInsert(input any) error {
	switch value := input.(type) {
	case string:
		if value == "" || !json.Valid([]byte(strconv.Quote(value))) {
			return ErrInvalid
		}
	case map[string]any:
		if len(value) != 1 {
			return ErrInvalid
		}
		for kind, payload := range value {
			switch kind {
			case "break":
				if enabled, ok := payload.(bool); !ok || !enabled {
					return ErrInvalid
				}
			case "mention":
				object, ok := payload.(map[string]any)
				if !ok || safeEditorString(object["id"], 160) == "" || len(safeEditorString(object["label"], 500)) > 500 {
					return ErrInvalid
				}
			case "attachment":
				object, ok := payload.(map[string]any)
				if !ok || safeEditorString(object["attachment_id"], 160) == "" {
					return ErrInvalid
				}
				encoded, _ := json.Marshal(object)
				if editorBytesContainSensitiveContent(encoded) {
					return ErrInvalid
				}
			default:
				return ErrInvalid
			}
		}
	default:
		return ErrInvalid
	}
	return nil
}

func validateEditorAttributes(attributes map[string]any, document bool) error {
	if len(attributes) > 24 {
		return ErrInvalid
	}
	for key, value := range attributes {
		if !editorInlineAttributeNames[key] && !editorBlockAttributeNames[key] {
			return ErrInvalid
		}
		if !document && value == nil {
			continue
		}
		switch typed := value.(type) {
		case bool:
		case string:
			if len(typed) > 2000 || editorBytesContainSensitiveContent([]byte(typed)) {
				return ErrInvalid
			}
		case float64:
			if typed < 0 || typed > 1000000 {
				return ErrInvalid
			}
		case int:
			if typed < 0 || typed > 1000000 {
				return ErrInvalid
			}
		default:
			return ErrInvalid
		}
	}
	return nil
}

func safeEditorString(value any, maximum int) string {
	text, _ := value.(string)
	text = strings.TrimSpace(text)
	if len(text) > maximum {
		return ""
	}
	return text
}

func editorBytesContainSensitiveContent(value []byte) bool {
	lower := strings.ToLower(string(value))
	for _, forbidden := range []string{"data:image/", ";base64,", "x-amz-credential", "x-amz-signature", "awsaccesskeyid", "presigned_url", "secret_access_key"} {
		if strings.Contains(lower, forbidden) {
			return true
		}
	}
	return false
}

func ApplyStructuredEditorOperation(state EditorCollaborationState, operation EditorCollaborationDelta) (EditorCollaborationState, error) {
	if len(operation.Ops) == 0 {
		return CloneEditorCollaborationState(state), nil
	}
	if err := ValidateEditorCollaborationState(state); err != nil {
		return EditorCollaborationState{}, err
	}
	if err := ValidateEditorCollaborationDelta(operation); err != nil {
		return EditorCollaborationState{}, err
	}
	length := 0
	for _, op := range state.Ops {
		switch insert := op.Insert.(type) {
		case string:
			length += len(utf16.Encode([]rune(insert)))
		default:
			length++
		}
	}
	cursor := 0
	for _, op := range operation.Ops {
		if op.Retain > 0 {
			cursor += op.Retain
		}
		if op.Delete > 0 {
			cursor += op.Delete
		}
		if cursor > length {
			return EditorCollaborationState{}, ErrVersionConflict
		}
	}
	base := editorDeltaToQuill(editorStateToDelta(state))
	change := editorDeltaToQuill(operation)
	result := editorDeltaToState(editorDeltaFromQuill(base.Compose(change)))
	if err := ValidateEditorCollaborationState(result); err != nil {
		return EditorCollaborationState{}, err
	}
	return result, nil
}

func TransformStructuredEditorOperation(committed, concurrent EditorCollaborationDelta, committedHasPriority bool) (EditorCollaborationDelta, error) {
	if len(committed.Ops) == 0 {
		return EditorCollaborationDelta{Ops: append([]EditorCollaborationOp(nil), concurrent.Ops...)}, nil
	}
	if len(concurrent.Ops) == 0 {
		return EditorCollaborationDelta{}, nil
	}
	if err := ValidateEditorCollaborationDelta(committed); err != nil {
		return EditorCollaborationDelta{}, err
	}
	if err := ValidateEditorCollaborationDelta(concurrent); err != nil {
		return EditorCollaborationDelta{}, err
	}
	left, right := editorDeltaToQuill(committed), editorDeltaToQuill(concurrent)
	result := editorDeltaFromQuill(left.Transform(right, committedHasPriority))
	return result, nil
}

func editorAttribute(node *xhtml.Node, name string) string {
	for _, attribute := range node.Attr {
		if strings.EqualFold(attribute.Key, name) {
			return strings.TrimSpace(attribute.Val)
		}
	}
	return ""
}

func editorElement(node *xhtml.Node, name string) bool {
	return node != nil && node.Type == xhtml.ElementNode && strings.EqualFold(node.Data, name)
}

func editorFirstDescendantElement(node *xhtml.Node, name string) *xhtml.Node {
	if editorElement(node, name) {
		return node
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if match := editorFirstDescendantElement(child, name); match != nil {
			return match
		}
	}
	return nil
}

func editorInlineAttributes(node *xhtml.Node, inherited map[string]any) map[string]any {
	next := cloneEditorAttributes(inherited)
	if next == nil {
		next = map[string]any{}
	}
	tag := strings.ToLower(node.Data)
	switch tag {
	case "strong", "b":
		next["bold"] = true
	case "em", "i":
		next["italic"] = true
	case "u":
		next["underline"] = true
	case "s", "strike":
		next["strike"] = true
	case "mark":
		next["highlight"] = "#fef08a"
	}
	style := strings.ToLower(editorAttribute(node, "style"))
	if strings.Contains(style, "font-weight:bold") || strings.Contains(style, "font-weight: bold") {
		next["bold"] = true
	}
	if strings.Contains(style, "font-style:italic") || strings.Contains(style, "font-style: italic") {
		next["italic"] = true
	}
	if tag == "a" {
		href := editorAttribute(node, "href")
		lower := strings.ToLower(href)
		if href != "" && !strings.HasPrefix(lower, "javascript:") && !strings.HasPrefix(lower, "data:") && !strings.Contains(lower, "x-amz-") {
			next["link"] = href
		}
	}
	return next
}

func editorBlockAttributes(node *xhtml.Node, block string) map[string]any {
	attributes := map[string]any{"block": block}
	align := strings.ToLower(editorAttribute(node, "align"))
	if align == "left" || align == "center" || align == "right" || align == "justify" {
		attributes["align"] = align
	}
	return attributes
}

func editorTextContent(node *xhtml.Node) string {
	var builder strings.Builder
	var visit func(*xhtml.Node)
	visit = func(current *xhtml.Node) {
		if current.Type == xhtml.TextNode {
			builder.WriteString(current.Data)
		}
		for child := current.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(node)
	return builder.String()
}

func EditorCollaborationStateFromHTML(source string) (EditorCollaborationState, error) {
	if source == "" {
		return EditorCollaborationState{Ops: []EditorCollaborationOp{}}, nil
	}
	context := &xhtml.Node{Type: xhtml.ElementNode, Data: "div", DataAtom: atom.Div}
	nodes, err := xhtml.ParseFragment(strings.NewReader(source), context)
	if err != nil {
		return EditorCollaborationState{}, ErrInvalid
	}
	state := EditorCollaborationState{}
	var appendInline func(*xhtml.Node, map[string]any)
	appendInline = func(node *xhtml.Node, attributes map[string]any) {
		if node.Type == xhtml.TextNode {
			appendEditorInsert(&state.Ops, strings.ReplaceAll(node.Data, "\r", ""), attributes)
			return
		}
		if node.Type != xhtml.ElementNode {
			return
		}
		mentionID := editorAttribute(node, "data-mention-user-id")
		if mentionID == "" {
			mentionID = editorAttribute(node, "data-mango-mention-user-id")
		}
		if mentionID != "" {
			appendEditorInsert(&state.Ops, map[string]any{"mention": map[string]any{"id": mentionID, "label": editorTextContent(node), "kind": editorAttribute(node, "data-mango-mention-kind")}}, attributes)
			return
		}
		attachmentID := editorAttribute(node, "data-mango-editor-attachment-id")
		if attachmentID == "" {
			attachmentID = editorAttribute(node, "data-mango-attachment-id")
		}
		if attachmentID != "" && (strings.EqualFold(node.Data, "img") || editorAttribute(node, "data-mango-editor-image") != "") {
			image := editorFirstDescendantElement(node, "img")
			if image == nil {
				image = node
			}
			appendEditorInsert(&state.Ops, map[string]any{"attachment": map[string]any{"attachment_id": attachmentID, "alt": editorAttribute(image, "alt"), "width": editorAttribute(image, "width"), "height": editorAttribute(image, "height"), "align": editorAttribute(node, "data-mango-editor-image-align")}}, attributes)
			return
		}
		if strings.EqualFold(node.Data, "br") {
			appendEditorInsert(&state.Ops, map[string]any{"break": true}, attributes)
			return
		}
		next := editorInlineAttributes(node, attributes)
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			appendInline(child, next)
		}
	}
	var appendLine func(*xhtml.Node, map[string]any)
	appendLine = func(node *xhtml.Node, attributes map[string]any) {
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			if editorElement(child, "ul") || editorElement(child, "ol") {
				continue
			}
			appendInline(child, nil)
		}
		appendEditorInsert(&state.Ops, "\n", attributes)
	}
	var appendList func(*xhtml.Node, int)
	appendList = func(list *xhtml.Node, indent int) {
		kind := "bullet"
		if editorElement(list, "ol") {
			kind = "ordered"
		} else if editorAttribute(list, "data-mango-editor-list") == "checklist" {
			kind = "checklist"
		}
		for item := list.FirstChild; item != nil; item = item.NextSibling {
			if !editorElement(item, "li") {
				continue
			}
			attributes := map[string]any{"block": "li", "list": kind, "indent": indent}
			if editorAttribute(item, "data-mango-editor-checklist-checked") == "true" {
				attributes["checked"] = true
			}
			appendLine(item, attributes)
			for nested := item.FirstChild; nested != nil; nested = nested.NextSibling {
				if editorElement(nested, "ul") || editorElement(nested, "ol") {
					appendList(nested, indent+1)
				}
			}
		}
	}
	tableIndex := 0
	appendTable := func(table *xhtml.Node) {
		tableID := editorAttribute(table, "data-mango-editor-table-id")
		if tableID == "" {
			tableID = "t" + strconv.Itoa(tableIndex)
			tableIndex++
		}
		rowIndex := 0
		var visitRows func(*xhtml.Node)
		visitRows = func(parent *xhtml.Node) {
			for row := parent.FirstChild; row != nil; row = row.NextSibling {
				if editorElement(row, "thead") || editorElement(row, "tbody") || editorElement(row, "tfoot") {
					visitRows(row)
					continue
				}
				if !editorElement(row, "tr") {
					continue
				}
				cellIndex := 0
				for cell := row.FirstChild; cell != nil; cell = cell.NextSibling {
					if !editorElement(cell, "td") && !editorElement(cell, "th") {
						continue
					}
					attributes := map[string]any{"block": "table_cell", "table_id": tableID, "table_row": rowIndex, "table_cell": cellIndex, "table_header": editorElement(cell, "th")}
					if value, _ := strconv.Atoi(editorAttribute(cell, "rowspan")); value > 1 {
						attributes["rowspan"] = value
					}
					if value, _ := strconv.Atoi(editorAttribute(cell, "colspan")); value > 1 {
						attributes["colspan"] = value
					}
					appendLine(cell, attributes)
					cellIndex++
				}
				rowIndex++
			}
		}
		visitRows(table)
	}
	blockTags := map[string]bool{"p": true, "div": true, "h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true, "blockquote": true, "pre": true}
	var appendBlock func(*xhtml.Node)
	appendBlock = func(node *xhtml.Node) {
		tag := strings.ToLower(node.Data)
		switch tag {
		case "ul", "ol":
			appendList(node, 0)
		case "table":
			appendTable(node)
		default:
			block := tag
			if !blockTags[block] {
				block = "p"
			}
			appendLine(node, editorBlockAttributes(node, block))
		}
	}
	fragment := false
	closeFragment := func() {
		if fragment {
			appendEditorInsert(&state.Ops, "\n", map[string]any{"block": "fragment"})
			fragment = false
		}
	}
	for _, node := range nodes {
		if node.Type == xhtml.ElementNode && (blockTags[strings.ToLower(node.Data)] || editorElement(node, "ul") || editorElement(node, "ol") || editorElement(node, "table")) {
			closeFragment()
			appendBlock(node)
		} else {
			appendInline(node, nil)
			fragment = true
		}
	}
	closeFragment()
	if err := ValidateEditorCollaborationState(state); err != nil {
		return EditorCollaborationState{}, err
	}
	return state, nil
}

func editorHTMLAttribute(value string) string {
	return stdhtml.EscapeString(value)
}

func editorInlineHTML(value string, attributes map[string]any) string {
	output := value
	if link, ok := attributes["link"].(string); ok && link != "" {
		output = "<a href=\"" + editorHTMLAttribute(link) + "\">" + output + "</a>"
	}
	if highlight, ok := attributes["highlight"].(string); ok && highlight != "" {
		output = "<mark data-mango-editor-highlight=\"" + editorHTMLAttribute(highlight) + "\">" + output + "</mark>"
	}
	if attributes["strike"] == true {
		output = "<s>" + output + "</s>"
	}
	if attributes["underline"] == true {
		output = "<u>" + output + "</u>"
	}
	if attributes["italic"] == true {
		output = "<em>" + output + "</em>"
	}
	if attributes["bold"] == true {
		output = "<strong>" + output + "</strong>"
	}
	return output
}

func editorEmbedHTML(insert map[string]any, attributes map[string]any) string {
	if insert["break"] == true {
		return "<br>"
	}
	if mention, ok := insert["mention"].(map[string]any); ok {
		id := safeEditorString(mention["id"], 160)
		label := safeEditorString(mention["label"], 500)
		kind := safeEditorString(mention["kind"], 80)
		kindAttribute := ""
		if kind != "" {
			kindAttribute = " data-mango-mention-kind=\"" + editorHTMLAttribute(kind) + "\""
		}
		return editorInlineHTML("<span data-mango-mention=\"true\" data-mango-mention-user-id=\""+editorHTMLAttribute(id)+"\""+kindAttribute+">"+stdhtml.EscapeString(label)+"</span>", attributes)
	}
	if attachment, ok := insert["attachment"].(map[string]any); ok {
		id := safeEditorString(attachment["attachment_id"], 160)
		alt := safeEditorString(attachment["alt"], 500)
		width := safeEditorString(attachment["width"], 40)
		height := safeEditorString(attachment["height"], 40)
		align := safeEditorString(attachment["align"], 40)
		wrapperAttributes := ""
		if align != "" {
			wrapperAttributes = " data-mango-editor-image-align=\"" + editorHTMLAttribute(align) + "\""
		}
		imageAttributes := ""
		if width != "" {
			imageAttributes += " width=\"" + editorHTMLAttribute(width) + "\""
		}
		if height != "" {
			imageAttributes += " height=\"" + editorHTMLAttribute(height) + "\""
		}
		return "<span data-mango-editor-image=\"true\" data-mango-editor-attachment-id=\"" + editorHTMLAttribute(id) + "\"" + wrapperAttributes + "><img src=\"mango-attachment:" + editorHTMLAttribute(id) + "\" data-mango-attachment-id=\"" + editorHTMLAttribute(id) + "\" alt=\"" + editorHTMLAttribute(alt) + "\"" + imageAttributes + "></span>"
	}
	return ""
}

type editorStructuredLine struct {
	HTML       string
	Attributes map[string]any
}

func editorStructuredLines(state EditorCollaborationState) []editorStructuredLine {
	lines := []editorStructuredLine{}
	inline := ""
	finish := func(attributes map[string]any) {
		next := cloneEditorAttributes(attributes)
		if next == nil {
			next = map[string]any{}
		}
		if _, ok := next["block"]; !ok {
			next["block"] = "fragment"
		}
		lines = append(lines, editorStructuredLine{HTML: inline, Attributes: next})
		inline = ""
	}
	for _, operation := range state.Ops {
		switch insert := operation.Insert.(type) {
		case string:
			parts := strings.Split(insert, "\n")
			for index, part := range parts {
				if part != "" {
					inline += editorInlineHTML(stdhtml.EscapeString(part), operation.Attributes)
				}
				if index < len(parts)-1 {
					finish(operation.Attributes)
				}
			}
		case map[string]any:
			inline += editorEmbedHTML(insert, operation.Attributes)
		}
	}
	if inline != "" {
		finish(map[string]any{"block": "fragment"})
	}
	return lines
}

func editorNumber(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func MaterializeStructuredEditorState(state EditorCollaborationState) (string, error) {
	if err := ValidateEditorCollaborationState(state); err != nil {
		return "", err
	}
	lines := editorStructuredLines(state)
	var output strings.Builder
	for index := 0; index < len(lines); {
		line := lines[index]
		if tableID, _ := line.Attributes["table_id"].(string); tableID != "" {
			end := index + 1
			for end < len(lines) && lines[end].Attributes["table_id"] == tableID {
				end++
			}
			output.WriteString("<table data-mango-editor-table=\"true\" data-mango-editor-table-id=\"" + editorHTMLAttribute(tableID) + "\"><tbody>")
			activeRow := -1
			for _, cell := range lines[index:end] {
				row := editorNumber(cell.Attributes["table_row"])
				if row != activeRow {
					if activeRow >= 0 {
						output.WriteString("</tr>")
					}
					output.WriteString("<tr>")
					activeRow = row
				}
				tag := "td"
				if cell.Attributes["table_header"] == true {
					tag = "th"
				}
				output.WriteString("<" + tag + ">")
				if cell.HTML == "" {
					output.WriteString("<br>")
				} else {
					output.WriteString(cell.HTML)
				}
				output.WriteString("</" + tag + ">")
			}
			if activeRow >= 0 {
				output.WriteString("</tr>")
			}
			output.WriteString("</tbody></table>")
			index = end
			continue
		}
		if kind, _ := line.Attributes["list"].(string); kind != "" {
			end := index + 1
			for end < len(lines) {
				if _, ok := lines[end].Attributes["list"].(string); !ok {
					break
				}
				end++
			}
			tag := "ul"
			if kind == "ordered" {
				tag = "ol"
			}
			output.WriteString("<" + tag + ">")
			for _, item := range lines[index:end] {
				output.WriteString("<li>")
				if item.HTML == "" {
					output.WriteString("<br>")
				} else {
					output.WriteString(item.HTML)
				}
				output.WriteString("</li>")
			}
			output.WriteString("</" + tag + ">")
			index = end
			continue
		}
		block, _ := line.Attributes["block"].(string)
		if block == "" || block == "fragment" {
			output.WriteString(line.HTML)
		} else {
			allowed := map[string]bool{"p": true, "div": true, "h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true, "blockquote": true, "pre": true}
			if !allowed[block] {
				block = "p"
			}
			output.WriteString("<" + block + ">")
			if line.HTML == "" {
				output.WriteString("<br>")
			} else {
				output.WriteString(line.HTML)
			}
			output.WriteString("</" + block + ">")
		}
		index++
	}
	return output.String(), nil
}

func SortedEditorAttributeKeys(attributes map[string]any) []string {
	keys := make([]string, 0, len(attributes))
	for key := range attributes {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
