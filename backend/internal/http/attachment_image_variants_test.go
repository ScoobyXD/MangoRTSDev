package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"strings"
	"testing"
)

type imageVariantTestStorage struct {
	bucket        string
	objects       map[string]fakeAttachmentObject
	getCalls      int
	putCalls      int
	headCalls     int
	headErr       error
	putErrKeyPart string
}

func newImageVariantTestStorage() *imageVariantTestStorage {
	return &imageVariantTestStorage{bucket: "variant-test-bucket", objects: make(map[string]fakeAttachmentObject)}
}

func (s *imageVariantTestStorage) Bucket() string { return s.bucket }

func (s *imageVariantTestStorage) GetObject(_ context.Context, input AttachmentGetObjectInput) (AttachmentGetObjectOutput, error) {
	s.getCalls++
	object, ok := s.objects[input.Key]
	if !ok {
		return AttachmentGetObjectOutput{}, ErrAttachmentObjectNotFound
	}
	return AttachmentGetObjectOutput{ContentType: object.contentType, ContentLength: int64(len(object.body)),
		Body: io.NopCloser(bytes.NewReader(object.body))}, nil
}

func (s *imageVariantTestStorage) PutObject(_ context.Context, input AttachmentPutObjectInput) error {
	s.putCalls++
	if s.putErrKeyPart != "" && strings.Contains(input.Key, s.putErrKeyPart) {
		return errors.New("injected variant put failure")
	}
	body, err := io.ReadAll(input.Body)
	if err != nil {
		return err
	}
	if int64(len(body)) != input.ContentLength {
		return fmt.Errorf("length=%d want=%d", len(body), input.ContentLength)
	}
	digest := sha256.Sum256(body)
	if hex.EncodeToString(digest[:]) != input.SHA256 {
		return fmt.Errorf("sha mismatch")
	}
	s.objects[input.Key] = fakeAttachmentObject{contentType: input.ContentType, body: body}
	return nil
}

func TestEnsureAttachmentImageVariantsPersistsUsableSiblingIndependently(t *testing.T) {
	repo, storage, attachment := seedImageVariantAttachment(t, encodedVariantTestPNG(t, 800, 600), "image/png")
	storage.putErrKeyPart = "/thumbnail/"
	if _, err := EnsureAttachmentImageVariants(context.Background(), repo, storage, attachment); err == nil {
		t.Fatal("injected thumbnail failure unexpectedly succeeded")
	}
	if _, err := repo.GetAttachmentVariant(context.Background(), attachment.CompanyID, attachment.AttachmentID, store.AttachmentVariantDisplay); err != nil {
		t.Fatalf("usable display sibling was not persisted: %v", err)
	}
	if _, err := repo.GetAttachmentVariant(context.Background(), attachment.CompanyID, attachment.AttachmentID, store.AttachmentVariantThumbnail); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("failed thumbnail row error = %v", err)
	}
	storage.putErrKeyPart = ""
	if variants, err := EnsureAttachmentImageVariants(context.Background(), repo, storage, attachment); err != nil || len(variants) != 2 {
		t.Fatalf("retry missing sibling = %+v, %v", variants, err)
	}
}

func (s *imageVariantTestStorage) HeadObject(_ context.Context, input AttachmentHeadObjectInput) (AttachmentHeadObjectOutput, error) {
	s.headCalls++
	if s.headErr != nil {
		return AttachmentHeadObjectOutput{}, s.headErr
	}
	object, ok := s.objects[input.Key]
	if !ok {
		return AttachmentHeadObjectOutput{}, ErrAttachmentObjectNotFound
	}
	return AttachmentHeadObjectOutput{ContentLength: int64(len(object.body))}, nil
}

func TestEnsureAttachmentImageVariantsCreatesCurrentDisplayAndThumbnailOnce(t *testing.T) {
	repo, storage, attachment := seedImageVariantAttachment(t, encodedVariantTestPNG(t, 800, 600), "image/png")
	variants, err := EnsureAttachmentImageVariants(context.Background(), repo, storage, attachment)
	if err != nil {
		t.Fatalf("EnsureAttachmentImageVariants: %v", err)
	}
	if len(variants) != 2 || storage.getCalls != 1 || storage.putCalls != 2 {
		t.Fatalf("generation result variants=%d gets=%d puts=%d", len(variants), storage.getCalls, storage.putCalls)
	}
	byType := make(map[string]domain.AttachmentVariant)
	for _, variant := range variants {
		byType[variant.VariantType] = variant
		if variant.GenerationVersion == nil || *variant.GenerationVersion != attachmentImageVariantGenerationVersion || variant.SHA256 == nil {
			t.Fatalf("variant generation metadata = %+v", variant)
		}
		if variant.StorageBucket != storage.bucket || !attachmentImageVariantIsCurrent(variant, attachment, variant.VariantType) {
			t.Fatalf("variant storage identity = %+v", variant)
		}
	}
	if got := []int{*byType[store.AttachmentVariantDisplay].Width, *byType[store.AttachmentVariantDisplay].Height}; got[0] != 800 || got[1] != 600 {
		t.Fatalf("display dimensions = %v", got)
	}
	if got := []int{*byType[store.AttachmentVariantThumbnail].Width, *byType[store.AttachmentVariantThumbnail].Height}; got[0] != 384 || got[1] != 288 {
		t.Fatalf("thumbnail dimensions = %v", got)
	}
	if byType[store.AttachmentVariantDisplay].ByteSize > attachmentImageDisplayMaxBytes || byType[store.AttachmentVariantThumbnail].ByteSize > attachmentImageThumbnailMaxBytes {
		t.Fatalf("variant exceeded output cap: %+v", byType)
	}

	second, err := EnsureAttachmentImageVariants(context.Background(), repo, storage, attachment)
	if err != nil || len(second) != 2 {
		t.Fatalf("idempotent EnsureAttachmentImageVariants = %+v, %v", second, err)
	}
	if storage.getCalls != 1 || storage.putCalls != 2 {
		t.Fatalf("idempotent replay touched storage: gets=%d puts=%d", storage.getCalls, storage.putCalls)
	}
	if storage.headCalls != 2 {
		t.Fatalf("idempotent replay HEAD checks = %d, want 2", storage.headCalls)
	}

	delete(storage.objects, byType[store.AttachmentVariantDisplay].StorageKey)
	third, err := EnsureAttachmentImageVariants(context.Background(), repo, storage, attachment)
	if err != nil || len(third) != 2 {
		t.Fatalf("repair missing current object = %+v, %v", third, err)
	}
	if storage.getCalls != 2 || storage.putCalls != 3 || storage.headCalls != 6 {
		t.Fatalf("missing-object repair calls: gets=%d puts=%d heads=%d", storage.getCalls, storage.putCalls, storage.headCalls)
	}

	storage.headErr = errors.New("transient head failure")
	if _, err := EnsureAttachmentImageVariants(context.Background(), repo, storage, attachment); err == nil || !strings.Contains(err.Error(), "transient head failure") {
		t.Fatalf("transient HEAD error = %v", err)
	}
}

func TestEnsureAttachmentImageVariantsServerSniffsAndSkipsUnsupportedOrAnimated(t *testing.T) {
	basePNG := encodedVariantTestPNG(t, 2, 2)
	tests := map[string][]byte{
		"gif":                []byte("GIF89a unsupported"),
		"webp":               []byte("RIFF\x10\x00\x00\x00WEBPVP8 unsupported"),
		"svg":                []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`),
		"avif":               []byte("\x00\x00\x00\x18ftypavif unsupported"),
		"heic":               []byte("\x00\x00\x00\x18ftypheic unsupported"),
		"apng":               insertAPNGAnimationControl(basePNG),
		"jpeg_orientation_6": variantTestJPEGWithOrientation(t, 6),
	}
	for name, payload := range tests {
		t.Run(name, func(t *testing.T) {
			repo, storage, attachment := seedImageVariantAttachment(t, payload, "image/png")
			if _, err := EnsureAttachmentImageVariants(context.Background(), repo, storage, attachment); err != ErrAttachmentImageVariantUnsupported {
				t.Fatalf("EnsureAttachmentImageVariants error = %v, want unsupported", err)
			}
			if storage.putCalls != 0 {
				t.Fatalf("unsupported input wrote %d variants", storage.putCalls)
			}
		})
	}
}

func variantTestJPEGWithOrientation(t *testing.T, orientation uint16) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	tiff := make([]byte, 26)
	copy(tiff[:2], "II")
	binary.LittleEndian.PutUint16(tiff[2:4], 42)
	binary.LittleEndian.PutUint32(tiff[4:8], 8)
	binary.LittleEndian.PutUint16(tiff[8:10], 1)
	binary.LittleEndian.PutUint16(tiff[10:12], 0x0112)
	binary.LittleEndian.PutUint16(tiff[12:14], 3)
	binary.LittleEndian.PutUint32(tiff[14:18], 1)
	binary.LittleEndian.PutUint16(tiff[18:20], orientation)
	payload := append([]byte("Exif\x00\x00"), tiff...)
	segment := []byte{0xff, 0xe1, byte((len(payload) + 2) >> 8), byte(len(payload) + 2)}
	segment = append(segment, payload...)
	original := encoded.Bytes()
	result := append([]byte{}, original[:2]...)
	result = append(result, segment...)
	result = append(result, original[2:]...)
	return result
}

func TestEnsureAttachmentImageVariantsRejectsOversizeBeforeStorageRead(t *testing.T) {
	repo, storage, attachment := seedImageVariantAttachment(t, []byte("tiny"), "image/png")
	attachment.ByteSize = attachmentImageVariantMaxSourceBytes + 1
	if _, err := EnsureAttachmentImageVariants(context.Background(), repo, storage, attachment); err != ErrAttachmentImageVariantBounds {
		t.Fatalf("oversize error = %v", err)
	}
	if storage.getCalls != 0 {
		t.Fatalf("oversize source caused %d storage reads", storage.getCalls)
	}
}

func TestAttachmentImageCodecIOHonorsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	readerCalls := 0
	reader := attachmentContextReader{ctx: ctx, reader: countingAttachmentReader{calls: &readerCalls}}
	buffer := make([]byte, 8)
	if n, err := reader.Read(buffer); n != 0 || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled reader = (%d, %v), want (0, context.Canceled)", n, err)
	}
	if readerCalls != 0 {
		t.Fatalf("canceled reader touched source %d times", readerCalls)
	}

	writerCalls := 0
	writer := attachmentContextWriter{ctx: ctx, writer: countingAttachmentWriter{calls: &writerCalls}}
	if n, err := writer.Write([]byte("variant")); n != 0 || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled writer = (%d, %v), want (0, context.Canceled)", n, err)
	}
	if writerCalls != 0 {
		t.Fatalf("canceled writer touched destination %d times", writerCalls)
	}
}

type countingAttachmentReader struct {
	calls *int
}

func (r countingAttachmentReader) Read(payload []byte) (int, error) {
	*r.calls++
	return copy(payload, "source"), nil
}

type countingAttachmentWriter struct {
	calls *int
}

func (w countingAttachmentWriter) Write(payload []byte) (int, error) {
	*w.calls++
	return len(payload), nil
}

func seedImageVariantAttachment(t *testing.T, body []byte, mimeType string) (*store.MemoryRepo, *imageVariantTestStorage, domain.Attachment) {
	t.Helper()
	repo := store.NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-111111111111"
	repo.EnsureCompany(companyID, "Image Variant Company")
	node, err := repo.CreateNode(companyID, "Image Variant Node")
	if err != nil {
		t.Fatalf("CreateNode: %v", err)
	}
	attachmentID := store.NewUUIDv7String()
	key := attachmentOriginalObjectKey(companyID, attachmentID)
	digest := sha256.Sum256(body)
	attachment, _, err := repo.CreateAttachmentWithResourceLink(store.AttachmentCreateInput{
		CompanyID: companyID, AttachmentID: attachmentID, OriginalFilename: "test-image", MimeType: mimeType,
		ByteSize: int64(len(body)), SHA256: hex.EncodeToString(digest[:]), StorageBucket: "variant-test-bucket", StorageKey: key,
		SourceKind: store.AttachmentSourceUserUpload,
		ResourceLink: store.ResourceAttachmentInput{CompanyID: companyID, ResourceType: "node", ResourceID: node.NodeID,
			RelationshipKind: store.AttachmentRelationshipInlineImage},
	})
	if err != nil {
		t.Fatalf("CreateAttachmentWithResourceLink: %v", err)
	}
	storage := newImageVariantTestStorage()
	storage.objects[key] = fakeAttachmentObject{contentType: mimeType, body: body}
	return repo, storage, attachment
}

func encodedVariantTestPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(x % 251), G: uint8(y % 251), B: uint8((x + y) % 251), A: 255})
		}
	}
	var output bytes.Buffer
	if err := png.Encode(&output, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return output.Bytes()
}

func insertAPNGAnimationControl(payload []byte) []byte {
	if len(payload) < 33 {
		return payload
	}
	chunk := make([]byte, 20)
	binary.BigEndian.PutUint32(chunk[:4], 8)
	copy(chunk[4:8], "acTL")
	binary.BigEndian.PutUint32(chunk[8:12], 2)
	binary.BigEndian.PutUint32(chunk[12:16], 0)
	// The detector intentionally does not need the CRC to decide that this is
	// animated; the bytes are never decoded or persisted as a derivative.
	result := make([]byte, 0, len(payload)+len(chunk))
	result = append(result, payload[:33]...)
	result = append(result, chunk...)
	result = append(result, payload[33:]...)
	return result
}
