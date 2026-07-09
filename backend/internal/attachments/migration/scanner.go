package migration

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
)

const (
	DefaultLargePayloadBytes = 1024 * 1024
	rewritePreviewLimit      = 320
)

var (
	inlineFileDataURLPattern = regexp.MustCompile(`(?is)data:((?:image|application)/[a-z0-9][a-z0-9.+-]*);base64,([a-z0-9+/=_\-\s]+)`)
	anyDataURLPattern        = regexp.MustCompile(`(?is)^data:([^;,]+);base64,(.+)$`)
)

type PayloadLocation struct {
	Table         string `json:"table"`
	Column        string `json:"column"`
	SourcePK      string `json:"source_pk"`
	CompanyID     string `json:"company_id,omitempty"`
	ResourceType  string `json:"resource_type,omitempty"`
	ResourceID    string `json:"resource_id,omitempty"`
	InformationID string `json:"information_id,omitempty"`
	MessageID     string `json:"message_id,omitempty"`
}

type ScanOptions struct {
	LargePayloadBytes int
}

type ScanResult struct {
	Location             PayloadLocation `json:"location"`
	PayloadBytes         int             `json:"payload_bytes"`
	LargePayload         bool            `json:"large_payload"`
	Signals              []string        `json:"signals,omitempty"`
	EmbeddedFiles        []EmbeddedFile  `json:"embedded_files,omitempty"`
	ProposedRewriteBytes int             `json:"proposed_rewrite_bytes,omitempty"`
	RewritePreview       string          `json:"rewrite_preview,omitempty"`
	RewrittenPayload     string          `json:"-"`
}

type EmbeddedFile struct {
	Occurrence      int    `json:"occurrence"`
	Kind            string `json:"kind"`
	JSONPath        string `json:"json_path,omitempty"`
	MimeType        string `json:"mime_type"`
	Filename        string `json:"filename"`
	EncodedBytes    int    `json:"encoded_bytes"`
	DecodedBytes    int64  `json:"estimated_decoded_bytes"`
	SHA256          string `json:"sha256,omitempty"`
	AttachmentID    string `json:"proposed_attachment_id,omitempty"`
	StorageKey      string `json:"proposed_storage_key,omitempty"`
	Replacement     string `json:"replacement,omitempty"`
	DecodeError     string `json:"decode_error,omitempty"`
	decodedByteData []byte
}

func (f EmbeddedFile) DecodedByteData() []byte {
	return append([]byte(nil), f.decodedByteData...)
}

func ScanPayload(location PayloadLocation, payload string, options ScanOptions) ScanResult {
	threshold := options.LargePayloadBytes
	if threshold <= 0 {
		threshold = DefaultLargePayloadBytes
	}
	result := ScanResult{
		Location:     cleanLocation(location),
		PayloadBytes: len([]byte(payload)),
	}
	result.LargePayload = result.PayloadBytes >= threshold
	result.Signals = scanSignals(payload, result.LargePayload)

	ctx := scanContext{location: result.Location}
	rewritten, ok := scanAndRewriteJSONPayload(&ctx, payload)
	if !ok {
		rewritten = rewriteDataURLsInString(&ctx, payload, "$")
	}
	result.EmbeddedFiles = ctx.files
	result.RewrittenPayload = rewritten
	if rewritten != payload {
		result.ProposedRewriteBytes = len([]byte(rewritten))
		result.RewritePreview = previewRewrite(rewritten)
	}
	result.Signals = mergeSignals(result.Signals, ctx.signals)
	return result
}

func (r ScanResult) HasSignal(signal string) bool {
	for _, item := range r.Signals {
		if item == signal {
			return true
		}
	}
	return false
}

func (r ScanResult) HasDurableInlineFileBytes() bool {
	if len(r.EmbeddedFiles) > 0 {
		return true
	}
	for _, signal := range r.Signals {
		switch signal {
		case "durable_data_url_field", "email_attachment_content", "large_payload_with_base64_marker":
			return true
		}
	}
	return false
}

func DeterministicAttachmentID(location PayloadLocation, shaHex string, occurrence int) string {
	seed := strings.Join([]string{
		strings.TrimSpace(location.CompanyID),
		strings.TrimSpace(location.Table),
		strings.TrimSpace(location.Column),
		strings.TrimSpace(location.SourcePK),
		strings.TrimSpace(shaHex),
		fmt.Sprintf("%d", occurrence),
	}, "\x00")
	sum := sha256.Sum256([]byte(seed))
	bytes := append([]byte(nil), sum[:16]...)
	bytes[6] = (bytes[6] & 0x0f) | 0x50
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16])
}

func AttachmentObjectKey(companyID, attachmentID string) string {
	return "companies/" + strings.TrimSpace(companyID) + "/attachments/" + strings.TrimSpace(attachmentID) + "/original"
}

func cleanLocation(location PayloadLocation) PayloadLocation {
	location.Table = strings.TrimSpace(location.Table)
	location.Column = strings.TrimSpace(location.Column)
	location.SourcePK = strings.TrimSpace(location.SourcePK)
	location.CompanyID = strings.TrimSpace(location.CompanyID)
	location.ResourceType = strings.TrimSpace(location.ResourceType)
	location.ResourceID = strings.TrimSpace(location.ResourceID)
	location.InformationID = strings.TrimSpace(location.InformationID)
	location.MessageID = strings.TrimSpace(location.MessageID)
	return location
}

type scanContext struct {
	location PayloadLocation
	files    []EmbeddedFile
	signals  []string
}

func scanAndRewriteJSONPayload(ctx *scanContext, payload string) (string, bool) {
	prefix := ""
	jsonText := strings.TrimSpace(payload)
	if strings.HasPrefix(payload, "<!-- mango-node-text-block-v1 -->") {
		prefix = "<!-- mango-node-text-block-v1 -->"
		jsonText = strings.TrimSpace(strings.TrimPrefix(payload, prefix))
	}
	if jsonText == "" || (jsonText[0] != '{' && jsonText[0] != '[') {
		return "", false
	}
	var value any
	if err := json.Unmarshal([]byte(jsonText), &value); err != nil {
		return "", false
	}
	rewritten := rewriteJSONValue(ctx, value, "$", false)
	raw, err := json.Marshal(rewritten)
	if err != nil {
		return "", false
	}
	return prefix + string(raw), true
}

func rewriteJSONValue(ctx *scanContext, value any, jsonPath string, inAttachmentArray bool) any {
	switch typed := value.(type) {
	case map[string]any:
		return rewriteJSONObject(ctx, typed, jsonPath, inAttachmentArray)
	case []any:
		out := make([]any, 0, len(typed))
		nextInAttachmentArray := pathLooksLikeAttachments(jsonPath)
		for index, item := range typed {
			out = append(out, rewriteJSONValue(ctx, item, fmt.Sprintf("%s[%d]", jsonPath, index), nextInAttachmentArray))
		}
		return out
	case string:
		return rewriteDataURLsInString(ctx, typed, jsonPath)
	default:
		return value
	}
}

func rewriteJSONObject(ctx *scanContext, object map[string]any, jsonPath string, inAttachmentArray bool) map[string]any {
	out := make(map[string]any, len(object)+4)
	looksAttachment := inAttachmentArray || objectLooksLikeAttachment(object, jsonPath)
	for key, value := range object {
		cleanKey := strings.TrimSpace(key)
		lowerKey := strings.ToLower(cleanKey)
		valuePath := jsonPath + "." + cleanKey
		stringValue, isString := value.(string)
		if isString && (lowerKey == "dataurl" || lowerKey == "data_url") {
			ctx.addSignal("durable_data_url_field")
			if file, ok := ctx.embeddedFileFromDataURL("durable_data_url_field", valuePath, stringValue, filenameFromObject(object)); ok {
				mergeAttachmentReference(out, file)
				continue
			}
		}
		if isString && lowerKey == "content" && looksAttachment && strings.TrimSpace(stringValue) != "" {
			if file, ok := ctx.embeddedFileFromBase64Content(valuePath, stringValue, mimeTypeFromObject(object), filenameFromObject(object)); ok {
				ctx.addSignal("email_attachment_content")
				mergeAttachmentReference(out, file)
				continue
			}
			ctx.addSignal("email_attachment_content")
		}
		out[key] = rewriteJSONValue(ctx, value, valuePath, looksAttachment)
	}
	return out
}

func rewriteDataURLsInString(ctx *scanContext, value string, jsonPath string) string {
	matches := inlineFileDataURLPattern.FindAllStringSubmatchIndex(value, -1)
	if len(matches) == 0 {
		return value
	}
	var builder strings.Builder
	last := 0
	for _, match := range matches {
		start, end := match[0], match[1]
		mimeStart, mimeEnd := match[2], match[3]
		encodedStart, encodedEnd := match[4], match[5]
		builder.WriteString(value[last:start])
		mimeType := value[mimeStart:mimeEnd]
		encoded := value[encodedStart:encodedEnd]
		file := ctx.embeddedFileFromEncoded("inline_data_url", jsonPath, mimeType, defaultFilename(mimeType, len(ctx.files)+1), encoded)
		builder.WriteString(file.Replacement)
		last = end
	}
	builder.WriteString(value[last:])
	return builder.String()
}

func (ctx *scanContext) embeddedFileFromDataURL(kind, jsonPath, dataURL, filename string) (EmbeddedFile, bool) {
	match := anyDataURLPattern.FindStringSubmatch(strings.TrimSpace(dataURL))
	if len(match) != 3 {
		return EmbeddedFile{}, false
	}
	mimeType := strings.TrimSpace(match[1])
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	if strings.TrimSpace(filename) == "" {
		filename = defaultFilename(mimeType, len(ctx.files)+1)
	}
	return ctx.embeddedFileFromEncoded(kind, jsonPath, mimeType, filename, match[2]), true
}

func (ctx *scanContext) embeddedFileFromBase64Content(jsonPath, encoded, mimeType, filename string) (EmbeddedFile, bool) {
	mimeType = strings.TrimSpace(mimeType)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	if strings.TrimSpace(filename) == "" {
		filename = defaultFilename(mimeType, len(ctx.files)+1)
	}
	file := ctx.embeddedFileFromEncoded("email_attachment_content", jsonPath, mimeType, filename, encoded)
	return file, file.DecodeError == ""
}

func (ctx *scanContext) embeddedFileFromEncoded(kind, jsonPath, mimeType, filename, encoded string) EmbeddedFile {
	occurrence := len(ctx.files) + 1
	cleanEncoded := cleanBase64(encoded)
	bytes, err := decodeBase64(cleanEncoded)
	file := EmbeddedFile{
		Occurrence:   occurrence,
		Kind:         kind,
		JSONPath:     jsonPath,
		MimeType:     strings.TrimSpace(mimeType),
		Filename:     strings.TrimSpace(filename),
		EncodedBytes: len(cleanEncoded),
		DecodedBytes: int64(estimatedDecodedBytes(cleanEncoded)),
	}
	if err != nil {
		file.DecodeError = err.Error()
	} else {
		sum := sha256.Sum256(bytes)
		file.SHA256 = hex.EncodeToString(sum[:])
		file.DecodedBytes = int64(len(bytes))
		file.decodedByteData = bytes
	}
	if file.SHA256 != "" && strings.TrimSpace(ctx.location.CompanyID) != "" {
		file.AttachmentID = DeterministicAttachmentID(ctx.location, file.SHA256, occurrence)
		file.StorageKey = AttachmentObjectKey(ctx.location.CompanyID, file.AttachmentID)
		file.Replacement = "mango-attachment:" + file.AttachmentID
	}
	if file.Replacement == "" && file.SHA256 != "" {
		file.Replacement = "mango-attachment:" + file.SHA256
	}
	ctx.files = append(ctx.files, file)
	return file
}

func mergeAttachmentReference(object map[string]any, file EmbeddedFile) {
	if file.AttachmentID != "" {
		object["attachment_id"] = file.AttachmentID
	}
	if file.Filename != "" {
		if _, exists := object["filename"]; !exists {
			object["filename"] = file.Filename
		}
		if _, exists := object["name"]; !exists {
			object["name"] = file.Filename
		}
	}
	if file.MimeType != "" {
		object["mime_type"] = file.MimeType
		object["content_type"] = file.MimeType
		if _, exists := object["type"]; !exists {
			object["type"] = file.MimeType
		}
	}
	if file.DecodedBytes >= 0 {
		object["byte_size"] = file.DecodedBytes
		object["size"] = file.DecodedBytes
	}
	if file.SHA256 != "" {
		object["sha256"] = file.SHA256
	}
}

func scanSignals(payload string, large bool) []string {
	lower := strings.ToLower(payload)
	var signals []string
	if strings.Contains(lower, "data:image/") {
		signals = append(signals, "data_image")
	}
	if strings.Contains(lower, "data:application/") {
		signals = append(signals, "data_application")
	}
	if strings.Contains(lower, "base64,") {
		signals = append(signals, "base64_marker")
		if large {
			signals = append(signals, "large_payload_with_base64_marker")
		}
	}
	if strings.Contains(lower, "dataurl") || strings.Contains(lower, "data_url") {
		signals = append(signals, "possible_data_url_field")
	}
	if large {
		signals = append(signals, "large_payload")
	}
	return mergeSignals(nil, signals)
}

func mergeSignals(left, right []string) []string {
	seen := map[string]bool{}
	for _, item := range left {
		item = strings.TrimSpace(item)
		if item != "" {
			seen[item] = true
		}
	}
	for _, item := range right {
		item = strings.TrimSpace(item)
		if item != "" {
			seen[item] = true
		}
	}
	out := make([]string, 0, len(seen))
	for item := range seen {
		out = append(out, item)
	}
	sort.Strings(out)
	return out
}

func (ctx *scanContext) addSignal(signal string) {
	signal = strings.TrimSpace(signal)
	if signal != "" {
		ctx.signals = append(ctx.signals, signal)
	}
}

func objectLooksLikeAttachment(object map[string]any, jsonPath string) bool {
	if pathLooksLikeAttachments(jsonPath) {
		return true
	}
	for _, key := range []string{"filename", "name", "content_type", "mime_type", "content_id", "content_disposition", "is_inline", "attachment_id"} {
		if _, ok := object[key]; ok {
			return true
		}
	}
	return false
}

func pathLooksLikeAttachments(jsonPath string) bool {
	return strings.Contains(strings.ToLower(jsonPath), "attachments")
}

func filenameFromObject(object map[string]any) string {
	for _, key := range []string{"filename", "name", "original_filename"} {
		if value, ok := object[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func mimeTypeFromObject(object map[string]any) string {
	for _, key := range []string{"content_type", "mime_type", "type"} {
		if value, ok := object[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func defaultFilename(mimeType string, occurrence int) string {
	extension := extensionForMimeType(mimeType)
	if extension == "" {
		extension = ".bin"
	}
	return fmt.Sprintf("migrated-attachment-%d%s", occurrence, extension)
}

func extensionForMimeType(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "application/pdf":
		return ".pdf"
	case "application/zip":
		return ".zip"
	}
	if strings.Contains(mimeType, "/") {
		ext := path.Ext(strings.ReplaceAll(mimeType, "+", "."))
		if ext != "" && len(ext) <= 12 {
			return ext
		}
	}
	return ""
}

func cleanBase64(value string) string {
	replacer := strings.NewReplacer("\r", "", "\n", "", "\t", "", " ", "")
	return replacer.Replace(strings.TrimSpace(value))
}

func decodeBase64(value string) ([]byte, error) {
	if value == "" {
		return nil, fmt.Errorf("empty base64 payload")
	}
	if decoded, err := base64.StdEncoding.DecodeString(value); err == nil {
		return decoded, nil
	}
	if decoded, err := base64.RawStdEncoding.DecodeString(strings.TrimRight(value, "=")); err == nil {
		return decoded, nil
	}
	padded := value
	if remainder := len(padded) % 4; remainder != 0 {
		padded += strings.Repeat("=", 4-remainder)
	}
	return base64.StdEncoding.DecodeString(padded)
}

func estimatedDecodedBytes(cleanEncoded string) int {
	if cleanEncoded == "" {
		return 0
	}
	padding := 0
	if strings.HasSuffix(cleanEncoded, "==") {
		padding = 2
	} else if strings.HasSuffix(cleanEncoded, "=") {
		padding = 1
	}
	return (len(cleanEncoded)*3)/4 - padding
}

func previewRewrite(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) <= rewritePreviewLimit {
		return value
	}
	return value[:rewritePreviewLimit] + "...[truncated]"
}
