package store

import (
	"encoding/json"
	"html"
	"miraeopus/backend/internal/domain"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"
)

const (
	NodeContentChangeAddition = "addition"
	NodeContentChangeDeletion = "deletion"

	editorTextBlockContentPrefix = "<!-- mango-node-text-block-v1 -->"
	editorRichTextPrefix         = "<!-- mango-editor-html-v1 -->"

	nodeProjectionContentChangePrefix = "projection:"
)

var htmlTagPattern = regexp.MustCompile(`(?s)<[^>]*>`)
var uuidTextPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type nodeContentChangeActor struct {
	userID      string
	displayName string
}

func normalizeNodeContentChangeActor(userID, displayName string) nodeContentChangeActor {
	displayName = strings.TrimSpace(displayName)
	if displayName == "" {
		displayName = "Unknown user"
	}
	return nodeContentChangeActor{
		userID:      strings.TrimSpace(userID),
		displayName: displayName,
	}
}

func cleanUUIDText(value string) string {
	value = strings.TrimSpace(value)
	if !uuidTextPattern.MatchString(value) {
		return ""
	}
	return strings.ToLower(value)
}

func buildNodeContentChanges(companyID, nodeID, informationID, infoType string, previous *domain.NodeProjection, nextInformation string, actor nodeContentChangeActor, now time.Time) []domain.NodeContentChange {
	if infoType != "Text box" {
		return nil
	}
	if strings.TrimSpace(actor.userID) == "" && strings.TrimSpace(actor.displayName) == "" {
		return nil
	}
	before := ""
	if previous != nil && previous.Type == "Text box" {
		before = extractNodeTextBlockDocumentText(previous.Information)
	}
	after := extractNodeTextBlockDocumentText(nextInformation)
	return diffNodeContentText(companyID, nodeID, informationID, before, after, actor, now)
}

func diffNodeContentText(companyID, nodeID, informationID, before, after string, actor nodeContentChangeActor, now time.Time) []domain.NodeContentChange {
	if before == after {
		return nil
	}
	beforeRunes := []rune(before)
	afterRunes := []rune(after)
	prefix := 0
	for prefix < len(beforeRunes) && prefix < len(afterRunes) && beforeRunes[prefix] == afterRunes[prefix] {
		prefix++
	}
	suffix := 0
	for suffix < len(beforeRunes)-prefix && suffix < len(afterRunes)-prefix &&
		beforeRunes[len(beforeRunes)-1-suffix] == afterRunes[len(afterRunes)-1-suffix] {
		suffix++
	}

	deletedText := string(beforeRunes[prefix : len(beforeRunes)-suffix])
	addedText := string(afterRunes[prefix : len(afterRunes)-suffix])
	startOffset := utf16CodeUnitLen(string(afterRunes[:prefix]))
	out := make([]domain.NodeContentChange, 0, 2)
	if strings.TrimSpace(deletedText) != "" {
		out = append(out, domain.NodeContentChange{
			CompanyID:        companyID,
			ChangeID:         newUUIDv7String(),
			NodeID:           nodeID,
			InformationID:    informationID,
			ChangeType:       NodeContentChangeDeletion,
			Text:             deletedText,
			StartOffset:      startOffset,
			EndOffset:        startOffset,
			ActorUserID:      actor.userID,
			ActorDisplayName: actor.displayName,
			CreatedTimestamp: now,
		})
	}
	if strings.TrimSpace(addedText) != "" {
		out = append(out, domain.NodeContentChange{
			CompanyID:        companyID,
			ChangeID:         newUUIDv7String(),
			NodeID:           nodeID,
			InformationID:    informationID,
			ChangeType:       NodeContentChangeAddition,
			Text:             addedText,
			StartOffset:      startOffset,
			EndOffset:        startOffset + utf16CodeUnitLen(addedText),
			ActorUserID:      actor.userID,
			ActorDisplayName: actor.displayName,
			CreatedTimestamp: now,
		})
	}
	return out
}

func buildNodeProjectionSnapshotChanges(companyID, nodeID, informationID, seenInformation, currentInformation string, actor nodeContentChangeActor, changedAt time.Time) []domain.NodeContentChange {
	before := extractNodeTextBlockDocumentText(seenInformation)
	after := extractNodeTextBlockDocumentText(currentInformation)
	changes := diffNodeContentText(companyID, nodeID, informationID, before, after, actor, changedAt)
	for index := range changes {
		changes[index].ChangeID = nodeProjectionContentChangeID(informationID, changes[index].ChangeType)
	}
	return changes
}

func nodeProjectionContentChangeID(informationID, changeType string) string {
	return nodeProjectionContentChangePrefix + strings.TrimSpace(informationID) + ":" + strings.TrimSpace(changeType)
}

func nodeProjectionInformationIDFromContentChangeID(changeID string) string {
	changeID = strings.TrimSpace(changeID)
	if !strings.HasPrefix(changeID, nodeProjectionContentChangePrefix) {
		return ""
	}
	remainder := strings.TrimPrefix(changeID, nodeProjectionContentChangePrefix)
	if index := strings.LastIndex(remainder, ":"); index >= 0 {
		remainder = remainder[:index]
	}
	return cleanUUIDText(remainder)
}

func utf16CodeUnitLen(value string) int {
	total := 0
	for _, char := range value {
		total += len(utf16.Encode([]rune{char}))
	}
	return total
}

func extractNodeTextBlockDocumentText(information string) string {
	document := information
	if strings.HasPrefix(information, editorTextBlockContentPrefix) {
		var payload struct {
			Document string `json:"document"`
		}
		if err := json.Unmarshal([]byte(information[len(editorTextBlockContentPrefix):]), &payload); err != nil {
			return ""
		}
		document = payload.Document
	}
	if strings.HasPrefix(document, editorRichTextPrefix) {
		return normalizeStoredEditorText(editorHTMLToText(document[len(editorRichTextPrefix):]))
	}
	return normalizeStoredEditorText(document)
}

func normalizeStoredEditorText(value string) string {
	return strings.ReplaceAll(value, "\u00a0", " ")
}

func editorHTMLToText(value string) string {
	var out strings.Builder
	appendText := func(text string) {
		if text == "" {
			return
		}
		out.WriteString(html.UnescapeString(text))
	}
	appendNewline := func() {
		current := out.String()
		if current == "" || strings.HasSuffix(current, "\n") {
			return
		}
		out.WriteByte('\n')
	}

	lastIndex := 0
	for _, location := range htmlTagPattern.FindAllStringIndex(value, -1) {
		appendText(value[lastIndex:location[0]])
		tag := strings.ToLower(strings.TrimSpace(value[location[0]+1 : location[1]-1]))
		tag = strings.TrimPrefix(tag, "/")
		tagName := tag
		if fieldIndex := strings.IndexFunc(tagName, func(r rune) bool { return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '/' }); fieldIndex >= 0 {
			tagName = tagName[:fieldIndex]
		}
		switch tagName {
		case "br":
			out.WriteByte('\n')
		case "div", "p", "li":
			appendNewline()
		}
		lastIndex = location[1]
	}
	appendText(value[lastIndex:])
	text := out.String()
	if strings.HasSuffix(text, "\n") {
		text = strings.TrimRight(text, "\n")
	}
	return text
}
