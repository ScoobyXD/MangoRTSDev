package httpapi

import (
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultAttachmentMaxBrowserUploadBytes = int64(1024 * 1024 * 1024)
	attachmentSinglePutMaxBytes            = int64(64 * 1024 * 1024)
	attachmentMultipartPartBytes           = int64(16 * 1024 * 1024)
	attachmentMaxConcurrentParts           = 3
	attachmentMaxPartSignBatch             = 8
	attachmentMaxMultipartParts            = 10000
)

type attachmentDirectUploadConfig struct {
	Enabled           bool
	MaxFileBytes      int64
	IntentLifetime    time.Duration
	SingleURLLifetime time.Duration
	PartURLLifetime   time.Duration
	CleanupInterval   time.Duration
}

func attachmentDirectUploadConfigFromEnv() attachmentDirectUploadConfig {
	return attachmentDirectUploadConfig{
		Enabled:           attachmentBoolEnv("MANGORTS_ATTACHMENT_DIRECT_UPLOAD_ENABLED", true),
		MaxFileBytes:      attachmentPositiveInt64Env("MANGORTS_ATTACHMENT_MAX_BROWSER_UPLOAD_BYTES", defaultAttachmentMaxBrowserUploadBytes),
		IntentLifetime:    attachmentDurationSecondsEnv("MANGORTS_ATTACHMENT_UPLOAD_INTENT_TTL_SECONDS", 24*time.Hour),
		SingleURLLifetime: attachmentDurationSecondsEnv("MANGORTS_ATTACHMENT_SINGLE_PUT_URL_TTL_SECONDS", time.Hour),
		PartURLLifetime:   attachmentDurationSecondsEnv("MANGORTS_ATTACHMENT_MULTIPART_PART_URL_TTL_SECONDS", 15*time.Minute),
		CleanupInterval:   attachmentDurationSecondsEnv("MANGORTS_ATTACHMENT_UPLOAD_CLEANUP_INTERVAL_SECONDS", 15*time.Minute),
	}
}

func (c attachmentDirectUploadConfig) normalized() attachmentDirectUploadConfig {
	if c.MaxFileBytes <= 0 {
		c.MaxFileBytes = defaultAttachmentMaxBrowserUploadBytes
	}
	if maxSupported := attachmentMultipartPartBytes * attachmentMaxMultipartParts; c.MaxFileBytes > maxSupported {
		c.MaxFileBytes = maxSupported
	}
	if c.IntentLifetime <= 0 {
		c.IntentLifetime = 24 * time.Hour
	}
	if c.SingleURLLifetime <= 0 || c.SingleURLLifetime > time.Hour {
		c.SingleURLLifetime = time.Hour
	}
	if c.PartURLLifetime <= 0 || c.PartURLLifetime > 15*time.Minute {
		c.PartURLLifetime = 15 * time.Minute
	}
	if c.CleanupInterval <= 0 {
		c.CleanupInterval = 15 * time.Minute
	}
	return c
}

func attachmentBoolEnv(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func attachmentPositiveInt64Env(key string, fallback int64) int64 {
	value, err := strconv.ParseInt(strings.TrimSpace(os.Getenv(key)), 10, 64)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func attachmentDurationSecondsEnv(key string, fallback time.Duration) time.Duration {
	seconds := attachmentPositiveInt64Env(key, int64(fallback/time.Second))
	return time.Duration(seconds) * time.Second
}
