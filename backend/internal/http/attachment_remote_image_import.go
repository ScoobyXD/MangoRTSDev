package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"path"
	"strings"
	"time"

	"miraeopus/backend/internal/store"
)

const (
	attachmentRemoteImageMaxBytes     int64 = 24_000_000
	attachmentRemoteImageMaxURLBytes        = 16 * 1024
	attachmentRemoteImageMaxRedirects       = 5
)

var allowedAttachmentRemoteImageMIMETypes = map[string]string{
	"image/gif":  ".gif",
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

var blockedAttachmentRemoteImagePrefixes = []netip.Prefix{
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
}

type attachmentRemoteImageImportRequest struct {
	CompanyID        string `json:"company_id"`
	ResourceType     string `json:"resource_type"`
	ResourceID       string `json:"resource_id"`
	SourceURL        string `json:"source_url"`
	OriginalFilename string `json:"original_filename"`
	InformationID    string `json:"information_id"`
	EditorSurface    string `json:"editor_surface"`
}

type attachmentRemoteImageDownload struct {
	Body              []byte
	MimeType          string
	SuggestedFilename string
}

type attachmentRemoteImageDownloader interface {
	Download(ctx context.Context, sourceURL *url.URL) (attachmentRemoteImageDownload, error)
}

type attachmentRemoteImageDownloadError struct {
	Status int
	Code   string
}

func (e *attachmentRemoteImageDownloadError) Error() string { return e.Code }

type safeAttachmentRemoteImageDownloader struct {
	client *http.Client
}

func newSafeAttachmentRemoteImageDownloader() attachmentRemoteImageDownloader {
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           dialSafeAttachmentRemoteImageAddress,
		ForceAttemptHTTP2:     true,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		IdleConnTimeout:       30 * time.Second,
	}
	return &safeAttachmentRemoteImageDownloader{client: &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= attachmentRemoteImageMaxRedirects {
				return &attachmentRemoteImageDownloadError{Status: http.StatusUnprocessableEntity, Code: "remote_image_redirect_limit"}
			}
			_, err := validateAttachmentRemoteImageSourceURL(req.URL.String())
			return err
		},
	}}
}

func validateAttachmentRemoteImageSourceURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > attachmentRemoteImageMaxURLBytes {
		return nil, &attachmentRemoteImageDownloadError{Status: http.StatusBadRequest, Code: "invalid_remote_image_url"}
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Opaque != "" || parsed.User != nil {
		return nil, &attachmentRemoteImageDownloadError{Status: http.StatusBadRequest, Code: "invalid_remote_image_url"}
	}
	parsed.Scheme = strings.ToLower(strings.TrimSpace(parsed.Scheme))
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, &attachmentRemoteImageDownloadError{Status: http.StatusBadRequest, Code: "invalid_remote_image_url"}
	}
	hostname := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(parsed.Hostname())), ".")
	if hostname == "" || hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") {
		return nil, &attachmentRemoteImageDownloadError{Status: http.StatusBadRequest, Code: "invalid_remote_image_url"}
	}
	port := parsed.Port()
	if port != "" && !((parsed.Scheme == "https" && port == "443") || (parsed.Scheme == "http" && port == "80")) {
		return nil, &attachmentRemoteImageDownloadError{Status: http.StatusBadRequest, Code: "invalid_remote_image_url"}
	}
	if literalIP := net.ParseIP(hostname); literalIP != nil && !isSafeAttachmentRemoteImageIP(literalIP) {
		return nil, &attachmentRemoteImageDownloadError{Status: http.StatusBadRequest, Code: "invalid_remote_image_url"}
	}
	parsed.Fragment = ""
	return parsed, nil
}

func isSafeAttachmentRemoteImageIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return false
	}
	address, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	address = address.Unmap()
	for _, blocked := range blockedAttachmentRemoteImagePrefixes {
		if blocked.Contains(address) {
			return false
		}
	}
	return true
}

func dialSafeAttachmentRemoteImageAddress(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, &attachmentRemoteImageDownloadError{Status: http.StatusBadRequest, Code: "invalid_remote_image_url"}
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(addresses) == 0 {
		return nil, &attachmentRemoteImageDownloadError{Status: http.StatusUnprocessableEntity, Code: "remote_image_fetch_failed"}
	}
	for _, candidate := range addresses {
		if !isSafeAttachmentRemoteImageIP(candidate.IP) {
			return nil, &attachmentRemoteImageDownloadError{Status: http.StatusBadRequest, Code: "invalid_remote_image_url"}
		}
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	return dialer.DialContext(ctx, network, net.JoinHostPort(addresses[0].IP.String(), port))
}

func normalizeAttachmentRemoteImageMIMEType(value string) string {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(value))
	if err != nil {
		return ""
	}
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	if _, ok := allowedAttachmentRemoteImageMIMETypes[mediaType]; !ok {
		return ""
	}
	return mediaType
}

func (d *safeAttachmentRemoteImageDownloader) Download(ctx context.Context, sourceURL *url.URL) (attachmentRemoteImageDownload, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL.String(), nil)
	if err != nil {
		return attachmentRemoteImageDownload{}, &attachmentRemoteImageDownloadError{Status: http.StatusBadRequest, Code: "invalid_remote_image_url"}
	}
	request.Header.Set("Accept", "image/png,image/jpeg,image/gif,image/webp;q=0.9")
	request.Header.Set("User-Agent", "MangoRTS rich-document image importer")
	response, err := d.client.Do(request)
	if err != nil {
		var typed *attachmentRemoteImageDownloadError
		if errors.As(err, &typed) {
			return attachmentRemoteImageDownload{}, typed
		}
		return attachmentRemoteImageDownload{}, &attachmentRemoteImageDownloadError{Status: http.StatusUnprocessableEntity, Code: "remote_image_fetch_failed"}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return attachmentRemoteImageDownload{}, &attachmentRemoteImageDownloadError{Status: http.StatusUnprocessableEntity, Code: "remote_image_fetch_failed"}
	}
	if response.ContentLength > attachmentRemoteImageMaxBytes {
		return attachmentRemoteImageDownload{}, &attachmentRemoteImageDownloadError{Status: http.StatusRequestEntityTooLarge, Code: "attachment_file_too_large"}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, attachmentRemoteImageMaxBytes+1))
	if err != nil {
		return attachmentRemoteImageDownload{}, &attachmentRemoteImageDownloadError{Status: http.StatusUnprocessableEntity, Code: "remote_image_fetch_failed"}
	}
	if int64(len(body)) > attachmentRemoteImageMaxBytes {
		return attachmentRemoteImageDownload{}, &attachmentRemoteImageDownloadError{Status: http.StatusRequestEntityTooLarge, Code: "attachment_file_too_large"}
	}
	if len(body) == 0 {
		return attachmentRemoteImageDownload{}, &attachmentRemoteImageDownloadError{Status: http.StatusUnprocessableEntity, Code: "remote_image_fetch_failed"}
	}
	detectedType := normalizeAttachmentRemoteImageMIMEType(http.DetectContentType(body[:min(len(body), 512)]))
	if detectedType == "" {
		return attachmentRemoteImageDownload{}, &attachmentRemoteImageDownloadError{Status: http.StatusUnprocessableEntity, Code: "remote_image_type_unsupported"}
	}
	return attachmentRemoteImageDownload{
		Body:              body,
		MimeType:          detectedType,
		SuggestedFilename: attachmentRemoteImageResponseFilename(response, sourceURL, detectedType),
	}, nil
}

func attachmentRemoteImageResponseFilename(response *http.Response, sourceURL *url.URL, mimeType string) string {
	filename := ""
	if disposition, params, err := mime.ParseMediaType(response.Header.Get("Content-Disposition")); err == nil && strings.TrimSpace(disposition) != "" {
		filename = params["filename"]
	}
	if strings.TrimSpace(filename) == "" {
		filename = path.Base(sourceURL.Path)
	}
	return sanitizeAttachmentRemoteImageFilename(filename, mimeType)
}

func sanitizeAttachmentRemoteImageFilename(value, mimeType string) string {
	value = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || r == '/' || r == '\\' {
			return -1
		}
		return r
	}, value))
	extension := allowedAttachmentRemoteImageMIMETypes[mimeType]
	if value == "" || value == "." {
		value = "pasted-image" + extension
	}
	if !strings.EqualFold(path.Ext(value), extension) {
		value = strings.TrimSuffix(value, path.Ext(value)) + extension
	}
	if len(value) > 240 {
		value = strings.TrimSpace(value[:240-len(extension)]) + extension
	}
	if value == extension {
		return "pasted-image" + extension
	}
	return value
}

func (s *Server) handleAttachmentRemoteImageImport(w http.ResponseWriter, r *http.Request) {
	if s.attachmentStorage == nil || s.attachmentRemoteImageDownloader == nil {
		writeError(w, http.StatusServiceUnavailable, "attachment_storage_unavailable")
		return
	}
	actor, ok := authenticatedActor(r)
	if !ok || strings.TrimSpace(actor.User.UserID) == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req attachmentRemoteImageImportRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return
	}
	req.CompanyID = strings.TrimSpace(req.CompanyID)
	req.ResourceType = store.NormalizeAttachmentResourceType(req.ResourceType)
	req.ResourceID = strings.TrimSpace(req.ResourceID)
	req.InformationID = strings.TrimSpace(req.InformationID)
	req.EditorSurface = strings.TrimSpace(req.EditorSurface)
	if req.CompanyID == "" || req.ResourceType == "" || req.ResourceID == "" {
		writeError(w, http.StatusBadRequest, "attachment_resource_context_required")
		return
	}
	if !s.requireAttachmentResourceEdit(w, r, req.CompanyID, req.ResourceType, req.ResourceID) {
		return
	}
	sourceURL, err := validateAttachmentRemoteImageSourceURL(req.SourceURL)
	if err != nil {
		writeAttachmentRemoteImageDownloadError(w, err)
		return
	}
	download, err := s.attachmentRemoteImageDownloader.Download(r.Context(), sourceURL)
	if err != nil {
		writeAttachmentRemoteImageDownloadError(w, err)
		return
	}
	if len(download.Body) == 0 {
		writeError(w, http.StatusUnprocessableEntity, "remote_image_type_unsupported")
		return
	}
	if int64(len(download.Body)) > attachmentRemoteImageMaxBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "attachment_file_too_large")
		return
	}
	detectedType := normalizeAttachmentRemoteImageMIMEType(http.DetectContentType(download.Body[:min(len(download.Body), 512)]))
	if detectedType == "" {
		writeError(w, http.StatusUnprocessableEntity, "remote_image_type_unsupported")
		return
	}
	download.MimeType = detectedType
	filename := sanitizeAttachmentRemoteImageFilename(req.OriginalFilename, download.MimeType)
	if strings.TrimSpace(req.OriginalFilename) == "" {
		filename = sanitizeAttachmentRemoteImageFilename(download.SuggestedFilename, download.MimeType)
	}
	attachmentID := store.NewUUIDv7String()
	storageKey := attachmentOriginalObjectKey(req.CompanyID, attachmentID)
	digest := sha256.Sum256(download.Body)
	digestHex := fmt.Sprintf("%x", digest[:])
	if err := s.attachmentStorage.PutObject(r.Context(), AttachmentPutObjectInput{
		Key: storageKey, ContentType: download.MimeType, ContentLength: int64(len(download.Body)), SHA256: digestHex,
		Body: bytes.NewReader(download.Body),
	}); err != nil {
		writeAttachmentStorageError(w, err)
		return
	}
	now := time.Now().UTC()
	attachment, link, err := s.repo.CreateAttachmentWithResourceLink(store.AttachmentCreateInput{
		CompanyID: req.CompanyID, AttachmentID: attachmentID, UploadedByUserID: strings.TrimSpace(actor.User.UserID),
		OriginalFilename: filename, MimeType: download.MimeType, ByteSize: int64(len(download.Body)), SHA256: digestHex,
		SHA256VerificationMethod: "server_stream", StorageChecksumAlgorithm: "SHA256",
		StorageChecksumValue: rawSHA256Base64(digestHex), StorageChecksumType: "FULL_OBJECT",
		StorageBucket: s.attachmentStorage.Bucket(), StorageKey: storageKey,
		SourceKind: store.AttachmentSourceEditorPaste, SourceProvider: "external_clipboard", CreatedTimestamp: now,
		ResourceLink: store.ResourceAttachmentInput{
			CompanyID: req.CompanyID, ResourceType: req.ResourceType, ResourceID: req.ResourceID,
			InformationID: req.InformationID, EditorSurface: req.EditorSurface,
			RelationshipKind: store.AttachmentRelationshipInlineImage, CreatedByUserID: strings.TrimSpace(actor.User.UserID),
			CreatedTimestamp: now,
		},
	})
	if err != nil {
		if deletable, ok := s.attachmentStorage.(interface {
			DeleteObject(context.Context, string) error
		}); ok {
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			_ = deletable.DeleteObject(cleanupCtx, storageKey)
			cancel()
		}
		if errors.Is(err, store.ErrInvalid) {
			writeError(w, http.StatusBadRequest, "invalid_attachment_import")
		} else if errors.Is(err, store.ErrNotFound) {
			writeAccessResourceNotFound(w)
		} else {
			writeError(w, http.StatusInternalServerError, "failed_to_import_attachment")
		}
		return
	}
	if s.attachmentVariantEnsurer != nil {
		variants, variantErr := s.attachmentVariantEnsurer.EnsureImageVariants(r.Context(), attachment)
		if variantErr != nil {
			log.Printf("attachment_remote_image_variants status=skipped attachment_id=%s", attachment.AttachmentID)
		} else {
			attachment.Variants = variants
		}
	}
	writeJSON(w, http.StatusCreated, attachmentUploadResponse{Attachment: attachment, ResourceAttachment: link})
}

func writeAttachmentRemoteImageDownloadError(w http.ResponseWriter, err error) {
	var typed *attachmentRemoteImageDownloadError
	if errors.As(err, &typed) {
		writeError(w, typed.Status, typed.Code)
		return
	}
	writeError(w, http.StatusUnprocessableEntity, "remote_image_fetch_failed")
}

var _ attachmentRemoteImageDownloader = (*safeAttachmentRemoteImageDownloader)(nil)
