package httpapi

import (
	"bufio"
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
	"os"
	"strings"
	"time"
)

const (
	attachmentImageVariantGenerationVersion = 1
	attachmentImageVariantMaxSourceBytes    = 64 << 20
	attachmentImageVariantMaxDimension      = 16384
	attachmentImageVariantMaxPixels         = 24_000_000
	attachmentImageDisplayMaxDimension      = 2048
	attachmentImageThumbnailMaxDimension    = 384
	attachmentImageDisplayMaxBytes          = 12 << 20
	attachmentImageThumbnailMaxBytes        = 2 << 20
	attachmentImageVariantGenerationTimeout = 20 * time.Second
)

var (
	ErrAttachmentImageVariantUnsupported = errors.New("attachment image variant unsupported")
	ErrAttachmentImageVariantBounds      = errors.New("attachment image variant bounds exceeded")
	attachmentImageVariantDecoderGate    = make(chan struct{}, 1)
)

type AttachmentImageVariantEnsurer interface {
	EnsureImageVariants(ctx context.Context, attachment domain.Attachment) ([]domain.AttachmentVariant, error)
}

type repositoryAttachmentImageVariantEnsurer struct {
	repo    store.AttachmentRepository
	storage AttachmentObjectStorage
}

func (e repositoryAttachmentImageVariantEnsurer) EnsureImageVariants(ctx context.Context, attachment domain.Attachment) ([]domain.AttachmentVariant, error) {
	return EnsureAttachmentImageVariants(ctx, e.repo, e.storage, attachment)
}

// EnsureAttachmentImageVariants creates current-generation derivatives only
// from server-sniffed static JPEG/PNG originals. It is intentionally called
// after original metadata/link finalization, and deterministic keys plus
// idempotent repository upserts make completed-intent replay safe.
func EnsureAttachmentImageVariants(ctx context.Context, repo store.AttachmentRepository, storage AttachmentObjectStorage, attachment domain.Attachment) ([]domain.AttachmentVariant, error) {
	ctx, cancel := context.WithTimeout(ctx, attachmentImageVariantGenerationTimeout)
	defer cancel()
	if repo == nil || storage == nil || strings.TrimSpace(attachment.CompanyID) == "" || strings.TrimSpace(attachment.AttachmentID) == "" {
		return nil, ErrAttachmentStorageUnavailable
	}
	needed, err := neededAttachmentImageVariants(ctx, repo, storage, attachment)
	if err != nil {
		return nil, err
	}
	if len(needed) == 0 {
		return attachmentCurrentImageVariants(ctx, repo, attachment.CompanyID, attachment.AttachmentID)
	}
	if attachment.ByteSize < 0 || attachment.ByteSize > attachmentImageVariantMaxSourceBytes {
		return nil, ErrAttachmentImageVariantBounds
	}
	select {
	case attachmentImageVariantDecoderGate <- struct{}{}:
		defer func() { <-attachmentImageVariantDecoderGate }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	needed, err = neededAttachmentImageVariants(ctx, repo, storage, attachment)
	if err != nil {
		return nil, err
	}
	if len(needed) == 0 {
		return attachmentCurrentImageVariants(ctx, repo, attachment.CompanyID, attachment.AttachmentID)
	}

	source, err := downloadAttachmentVariantSource(ctx, storage, attachment)
	if err != nil {
		return nil, err
	}
	defer source.Close()
	defer os.Remove(source.Name())

	decoded, format, err := decodeStaticAttachmentImage(ctx, source)
	if err != nil {
		return nil, err
	}
	var firstErr error
	for _, definition := range []struct {
		variantType  string
		maxDimension int
		maxBytes     int64
	}{
		{store.AttachmentVariantDisplay, attachmentImageDisplayMaxDimension, attachmentImageDisplayMaxBytes},
		{store.AttachmentVariantThumbnail, attachmentImageThumbnailMaxDimension, attachmentImageThumbnailMaxBytes},
	} {
		if !needed[definition.variantType] {
			continue
		}
		width, height := containedAttachmentImageDimensions(decoded.Bounds().Dx(), decoded.Bounds().Dy(), definition.maxDimension)
		resized, err := resizeAttachmentImageBilinear(ctx, decoded, width, height)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		variantFile, size, digest, mimeType, extension, err := encodeAttachmentImageVariant(ctx, resized, format, definition.maxBytes)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		key := attachmentImageVariantObjectKey(attachment.CompanyID, attachment.AttachmentID, definition.variantType, digest, extension)
		putErr := storage.PutObject(ctx, AttachmentPutObjectInput{Key: key, ContentType: mimeType, ContentLength: size, SHA256: digest, Body: variantFile})
		name := variantFile.Name()
		_ = variantFile.Close()
		_ = os.Remove(name)
		if putErr != nil {
			if firstErr == nil {
				firstErr = putErr
			}
			continue
		}
		digestCopy := digest
		generation := attachmentImageVariantGenerationVersion
		widthCopy, heightCopy := width, height
		input := store.AttachmentVariantInput{
			AttachmentID: attachment.AttachmentID, VariantType: definition.variantType, MimeType: mimeType,
			ByteSize: size, SHA256: &digestCopy, GenerationVersion: &generation, Width: &widthCopy, Height: &heightCopy,
			StorageBucket: storage.Bucket(), StorageKey: key, CreatedTimestamp: time.Now().UTC(),
		}
		if _, err := repo.UpsertAttachmentVariants(ctx, attachment.CompanyID, []store.AttachmentVariantInput{input}); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
	}
	if firstErr != nil {
		return nil, firstErr
	}
	return attachmentCurrentImageVariants(ctx, repo, attachment.CompanyID, attachment.AttachmentID)
}

func neededAttachmentImageVariants(ctx context.Context, repo store.AttachmentRepository, storage AttachmentObjectStorage, attachment domain.Attachment) (map[string]bool, error) {
	needed := make(map[string]bool, 2)
	for _, variantType := range []string{store.AttachmentVariantDisplay, store.AttachmentVariantThumbnail} {
		variant, err := repo.GetAttachmentVariant(ctx, attachment.CompanyID, attachment.AttachmentID, variantType)
		if err == nil && attachmentImageVariantIsCurrent(variant, attachment, variantType) {
			exists, existsErr := attachmentImageVariantObjectExists(ctx, storage, variant)
			if existsErr != nil {
				return nil, existsErr
			}
			if exists {
				continue
			}
		}
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return nil, err
		}
		needed[variantType] = true
	}
	return needed, nil
}

func attachmentImageVariantIsCurrent(variant domain.AttachmentVariant, attachment domain.Attachment, variantType string) bool {
	if variant.GenerationVersion == nil || *variant.GenerationVersion != attachmentImageVariantGenerationVersion ||
		variant.SHA256 == nil || len(strings.TrimSpace(*variant.SHA256)) != sha256.Size*2 {
		return false
	}
	wantPrefix := "companies/" + strings.TrimSpace(attachment.CompanyID) + "/attachments/" + strings.TrimSpace(attachment.AttachmentID) +
		"/variants/v" + fmt.Sprint(attachmentImageVariantGenerationVersion) + "/" + variantType + "/"
	return strings.HasPrefix(variant.StorageKey, wantPrefix)
}

// AttachmentImageVariantsCurrent reports whether both normal UI derivatives
// are already on the current deterministic generation. Backfill tooling uses
// this immediately before generation so a concurrent/replayed run is reported
// as current rather than as newly generated.
func AttachmentImageVariantsCurrent(ctx context.Context, repo store.AttachmentRepository, storage AttachmentObjectStorage, attachment domain.Attachment) (bool, error) {
	for _, variantType := range []string{store.AttachmentVariantDisplay, store.AttachmentVariantThumbnail} {
		variant, err := repo.GetAttachmentVariant(ctx, attachment.CompanyID, attachment.AttachmentID, variantType)
		if errors.Is(err, store.ErrNotFound) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if !attachmentImageVariantIsCurrent(variant, attachment, variantType) {
			return false, nil
		}
		exists, err := attachmentImageVariantObjectExists(ctx, storage, variant)
		if err != nil {
			return false, err
		}
		if !exists {
			return false, nil
		}
	}
	return true, nil
}

func attachmentImageVariantObjectExists(ctx context.Context, storage AttachmentObjectStorage, variant domain.AttachmentVariant) (bool, error) {
	if headStorage, ok := storage.(interface {
		HeadObject(context.Context, AttachmentHeadObjectInput) (AttachmentHeadObjectOutput, error)
	}); ok {
		head, err := headStorage.HeadObject(ctx, AttachmentHeadObjectInput{Key: variant.StorageKey})
		if errors.Is(err, ErrAttachmentObjectNotFound) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if head.ContentLength != variant.ByteSize {
			return false, nil
		}
		if variant.SHA256 != nil && strings.TrimSpace(head.ChecksumValue) != "" &&
			strings.TrimSpace(head.ChecksumValue) != rawSHA256Base64(strings.TrimSpace(*variant.SHA256)) {
			return false, nil
		}
		return true, nil
	}
	output, err := storage.GetObject(ctx, AttachmentGetObjectInput{Key: variant.StorageKey})
	if errors.Is(err, ErrAttachmentObjectNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer output.Body.Close()
	return output.ContentLength == variant.ByteSize, nil
}

func attachmentCurrentImageVariants(ctx context.Context, repo store.AttachmentRepository, companyID, attachmentID string) ([]domain.AttachmentVariant, error) {
	items := make([]domain.AttachmentVariant, 0, 2)
	for _, variantType := range []string{store.AttachmentVariantDisplay, store.AttachmentVariantThumbnail} {
		variant, err := repo.GetAttachmentVariant(ctx, companyID, attachmentID, variantType)
		if err != nil {
			return nil, err
		}
		items = append(items, variant)
	}
	return items, nil
}

func downloadAttachmentVariantSource(ctx context.Context, storage AttachmentObjectStorage, attachment domain.Attachment) (*os.File, error) {
	output, err := storage.GetObject(ctx, AttachmentGetObjectInput{Key: attachment.StorageKey})
	if err != nil {
		return nil, err
	}
	defer output.Body.Close()
	if output.ContentLength > attachmentImageVariantMaxSourceBytes || output.ContentLength != attachment.ByteSize {
		return nil, ErrAttachmentImageVariantBounds
	}
	file, err := os.CreateTemp("", "mango-attachment-variant-source-*")
	if err != nil {
		return nil, err
	}
	failed := true
	defer func() {
		if failed {
			name := file.Name()
			_ = file.Close()
			_ = os.Remove(name)
		}
	}()
	hasher := sha256.New()
	reader := attachmentContextReader{ctx: ctx, reader: output.Body}
	header := make([]byte, 12)
	n, headerErr := io.ReadFull(reader, header)
	if headerErr != nil && !errors.Is(headerErr, io.ErrUnexpectedEOF) {
		return nil, headerErr
	}
	header = header[:n]
	if !attachmentImageMagicSupported(header) {
		return nil, ErrAttachmentImageVariantUnsupported
	}
	written, err := io.MultiWriter(file, hasher).Write(header)
	if err == nil {
		var copied int64
		copied, err = io.Copy(io.MultiWriter(file, hasher), io.LimitReader(reader, attachmentImageVariantMaxSourceBytes+1-int64(written)))
		written += int(copied)
	}
	if err != nil {
		return nil, err
	}
	writtenBytes := int64(written)
	if writtenBytes != attachment.ByteSize || writtenBytes > attachmentImageVariantMaxSourceBytes || hex.EncodeToString(hasher.Sum(nil)) != strings.ToLower(attachment.SHA256) {
		return nil, ErrAttachmentImageVariantBounds
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	failed = false
	return file, nil
}

func attachmentImageMagicSupported(header []byte) bool {
	return (len(header) >= 3 && header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff) ||
		(len(header) >= 8 && string(header[:8]) == "\x89PNG\r\n\x1a\n")
}

func decodeStaticAttachmentImage(ctx context.Context, file *os.File) (image.Image, string, error) {
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	header := make([]byte, 12)
	n, err := io.ReadFull(file, header)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
		return nil, "", err
	}
	header = header[:n]
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, "", err
	}
	format := ""
	var config image.Config
	switch {
	case len(header) >= 3 && header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff:
		orientation, orientationErr := attachmentJPEGEXIFOrientation(file)
		if orientationErr != nil || orientation != 1 {
			return nil, "", ErrAttachmentImageVariantUnsupported
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return nil, "", err
		}
		config, err = jpeg.DecodeConfig(attachmentContextReader{ctx: ctx, reader: file})
		format = "jpeg"
	case len(header) >= 8 && string(header[:8]) == "\x89PNG\r\n\x1a\n":
		animated, inspectErr := attachmentPNGIsAnimated(ctx, file)
		if inspectErr != nil {
			return nil, "", inspectErr
		}
		if animated {
			return nil, "", ErrAttachmentImageVariantUnsupported
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return nil, "", err
		}
		config, err = png.DecodeConfig(attachmentContextReader{ctx: ctx, reader: file})
		format = "png"
	default:
		return nil, "", ErrAttachmentImageVariantUnsupported
	}
	if err != nil {
		return nil, "", ErrAttachmentImageVariantUnsupported
	}
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	if config.Width < 1 || config.Height < 1 || config.Width > attachmentImageVariantMaxDimension ||
		config.Height > attachmentImageVariantMaxDimension || int64(config.Width)*int64(config.Height) > attachmentImageVariantMaxPixels {
		return nil, "", ErrAttachmentImageVariantBounds
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, "", err
	}
	var decoded image.Image
	if format == "jpeg" {
		decoded, err = jpeg.Decode(attachmentContextReader{ctx: ctx, reader: file})
	} else {
		decoded, err = png.Decode(attachmentContextReader{ctx: ctx, reader: file})
	}
	if err != nil {
		return nil, "", ErrAttachmentImageVariantUnsupported
	}
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	return decoded, format, nil
}

func attachmentJPEGEXIFOrientation(file *os.File) (int, error) {
	if _, err := file.Seek(2, io.SeekStart); err != nil {
		return 0, err
	}
	reader := bufio.NewReader(file)
	for {
		prefix, err := reader.ReadByte()
		if err != nil {
			return 0, err
		}
		if prefix != 0xff {
			continue
		}
		marker, err := reader.ReadByte()
		if err != nil {
			return 0, err
		}
		for marker == 0xff {
			marker, err = reader.ReadByte()
			if err != nil {
				return 0, err
			}
		}
		if marker == 0xda || marker == 0xd9 {
			return 1, nil
		}
		if marker == 0x01 || (marker >= 0xd0 && marker <= 0xd8) {
			continue
		}
		lengthBytes := make([]byte, 2)
		if _, err := io.ReadFull(reader, lengthBytes); err != nil {
			return 0, err
		}
		length := int(binary.BigEndian.Uint16(lengthBytes)) - 2
		if length < 0 {
			return 0, ErrAttachmentImageVariantUnsupported
		}
		payload := make([]byte, length)
		if _, err := io.ReadFull(reader, payload); err != nil {
			return 0, err
		}
		if marker == 0xe1 && len(payload) >= 6 && string(payload[:6]) == "Exif\x00\x00" {
			return parseAttachmentEXIFOrientation(payload[6:])
		}
	}
}

func parseAttachmentEXIFOrientation(tiff []byte) (int, error) {
	if len(tiff) < 8 {
		return 0, ErrAttachmentImageVariantUnsupported
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 0, ErrAttachmentImageVariantUnsupported
	}
	if order.Uint16(tiff[2:4]) != 42 {
		return 0, ErrAttachmentImageVariantUnsupported
	}
	offset := int(order.Uint32(tiff[4:8]))
	if offset < 0 || offset+2 > len(tiff) {
		return 0, ErrAttachmentImageVariantUnsupported
	}
	count := int(order.Uint16(tiff[offset : offset+2]))
	entries := offset + 2
	if count < 0 || entries+count*12 > len(tiff) {
		return 0, ErrAttachmentImageVariantUnsupported
	}
	for index := 0; index < count; index++ {
		entry := tiff[entries+index*12 : entries+(index+1)*12]
		if order.Uint16(entry[:2]) != 0x0112 {
			continue
		}
		if order.Uint16(entry[2:4]) != 3 || order.Uint32(entry[4:8]) != 1 {
			return 0, ErrAttachmentImageVariantUnsupported
		}
		orientation := int(order.Uint16(entry[8:10]))
		if orientation < 1 || orientation > 8 {
			return 0, ErrAttachmentImageVariantUnsupported
		}
		return orientation, nil
	}
	return 1, nil
}

func attachmentPNGIsAnimated(ctx context.Context, file *os.File) (bool, error) {
	if _, err := file.Seek(8, io.SeekStart); err != nil {
		return false, err
	}
	reader := bufio.NewReader(file)
	for {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		header := make([]byte, 8)
		if _, err := io.ReadFull(reader, header); err != nil {
			return false, ErrAttachmentImageVariantUnsupported
		}
		length := int64(binary.BigEndian.Uint32(header[:4]))
		chunkType := string(header[4:8])
		if length < 0 || length > attachmentImageVariantMaxSourceBytes {
			return false, ErrAttachmentImageVariantUnsupported
		}
		if chunkType == "acTL" {
			return true, nil
		}
		if _, err := io.CopyN(io.Discard, reader, length+4); err != nil {
			return false, ErrAttachmentImageVariantUnsupported
		}
		if chunkType == "IDAT" || chunkType == "IEND" {
			return false, nil
		}
	}
}

func containedAttachmentImageDimensions(width, height, maxDimension int) (int, int) {
	if width <= maxDimension && height <= maxDimension {
		return width, height
	}
	if width >= height {
		return maxDimension, max(1, int((int64(height)*int64(maxDimension))/int64(width)))
	}
	return max(1, int((int64(width)*int64(maxDimension))/int64(height))), maxDimension
}

func resizeAttachmentImageBilinear(ctx context.Context, source image.Image, width, height int) (*image.NRGBA, error) {
	bounds := source.Bounds()
	if bounds.Dx() == width && bounds.Dy() == height {
		destination := image.NewNRGBA(image.Rect(0, 0, width, height))
		for y := 0; y < height; y++ {
			if y%32 == 0 {
				if err := ctx.Err(); err != nil {
					return nil, err
				}
			}
			for x := 0; x < width; x++ {
				destination.SetNRGBA(x, y, color.NRGBAModel.Convert(source.At(bounds.Min.X+x, bounds.Min.Y+y)).(color.NRGBA))
			}
		}
		return destination, nil
	}
	destination := image.NewNRGBA(image.Rect(0, 0, width, height))
	sxScale := float64(bounds.Dx()) / float64(width)
	syScale := float64(bounds.Dy()) / float64(height)
	for y := 0; y < height; y++ {
		if y%32 == 0 {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
		}
		sy := (float64(y)+0.5)*syScale - 0.5
		y0 := max(0, min(bounds.Dy()-1, int(sy)))
		y1 := min(bounds.Dy()-1, y0+1)
		fy := sy - float64(y0)
		if fy < 0 {
			fy = 0
		}
		for x := 0; x < width; x++ {
			sx := (float64(x)+0.5)*sxScale - 0.5
			x0 := max(0, min(bounds.Dx()-1, int(sx)))
			x1 := min(bounds.Dx()-1, x0+1)
			fx := sx - float64(x0)
			if fx < 0 {
				fx = 0
			}
			c00 := color.NRGBAModel.Convert(source.At(bounds.Min.X+x0, bounds.Min.Y+y0)).(color.NRGBA)
			c10 := color.NRGBAModel.Convert(source.At(bounds.Min.X+x1, bounds.Min.Y+y0)).(color.NRGBA)
			c01 := color.NRGBAModel.Convert(source.At(bounds.Min.X+x0, bounds.Min.Y+y1)).(color.NRGBA)
			c11 := color.NRGBAModel.Convert(source.At(bounds.Min.X+x1, bounds.Min.Y+y1)).(color.NRGBA)
			destination.SetNRGBA(x, y, color.NRGBA{
				R: interpolateAttachmentChannel(c00.R, c10.R, c01.R, c11.R, fx, fy),
				G: interpolateAttachmentChannel(c00.G, c10.G, c01.G, c11.G, fx, fy),
				B: interpolateAttachmentChannel(c00.B, c10.B, c01.B, c11.B, fx, fy),
				A: interpolateAttachmentChannel(c00.A, c10.A, c01.A, c11.A, fx, fy),
			})
		}
	}
	return destination, nil
}

func interpolateAttachmentChannel(c00, c10, c01, c11 uint8, fx, fy float64) uint8 {
	top := float64(c00)*(1-fx) + float64(c10)*fx
	bottom := float64(c01)*(1-fx) + float64(c11)*fx
	value := top*(1-fy) + bottom*fy
	return uint8(max(0, min(255, int(value+0.5))))
}

type attachmentLimitedWriter struct {
	w         io.Writer
	remaining int64
}

func (w *attachmentLimitedWriter) Write(payload []byte) (int, error) {
	if int64(len(payload)) > w.remaining {
		return 0, ErrAttachmentImageVariantBounds
	}
	n, err := w.w.Write(payload)
	w.remaining -= int64(n)
	return n, err
}

func encodeAttachmentImageVariant(ctx context.Context, source image.Image, format string, maxBytes int64) (*os.File, int64, string, string, string, error) {
	file, err := os.CreateTemp("", "mango-attachment-variant-output-*")
	if err != nil {
		return nil, 0, "", "", "", err
	}
	failed := true
	defer func() {
		if failed {
			name := file.Name()
			_ = file.Close()
			_ = os.Remove(name)
		}
	}()
	if err := ctx.Err(); err != nil {
		return nil, 0, "", "", "", err
	}
	hasher := sha256.New()
	writer := &attachmentContextWriter{
		ctx:    ctx,
		writer: &attachmentLimitedWriter{w: io.MultiWriter(file, hasher), remaining: maxBytes},
	}
	mimeType, extension := "image/png", "png"
	if format == "jpeg" {
		mimeType, extension = "image/jpeg", "jpg"
		err = jpeg.Encode(writer, source, &jpeg.Options{Quality: 90})
	} else {
		err = (&png.Encoder{CompressionLevel: png.DefaultCompression}).Encode(writer, source)
	}
	if err != nil {
		return nil, 0, "", "", "", err
	}
	if err := ctx.Err(); err != nil {
		return nil, 0, "", "", "", err
	}
	info, err := file.Stat()
	if err != nil {
		return nil, 0, "", "", "", err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, 0, "", "", "", err
	}
	failed = false
	return file, info.Size(), hex.EncodeToString(hasher.Sum(nil)), mimeType, extension, nil
}

type attachmentContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r attachmentContextReader) Read(payload []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := r.reader.Read(payload)
	if err == nil {
		if contextErr := r.ctx.Err(); contextErr != nil {
			return n, contextErr
		}
	}
	return n, err
}

type attachmentContextWriter struct {
	ctx    context.Context
	writer io.Writer
}

func (w attachmentContextWriter) Write(payload []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := w.writer.Write(payload)
	if err == nil {
		if contextErr := w.ctx.Err(); contextErr != nil {
			return n, contextErr
		}
	}
	return n, err
}

func attachmentImageVariantObjectKey(companyID, attachmentID, variantType, digest, extension string) string {
	return "companies/" + strings.TrimSpace(companyID) + "/attachments/" + strings.TrimSpace(attachmentID) +
		"/variants/v" + fmt.Sprint(attachmentImageVariantGenerationVersion) + "/" + variantType + "/" + digest + "." + extension
}
