package store

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

// newUUIDv7String returns an RFC9562-compatible UUIDv7 string.
// It uses unix milliseconds + randomness and sets version/variant bits.
func newUUIDv7String() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// deterministic fallback shape if entropy fails
		now := time.Now().UTC().UnixNano()
		for i := range b {
			b[i] = byte(now >> uint((i%8)*8))
		}
	}

	ms := uint64(time.Now().UTC().UnixMilli())
	b[0] = byte(ms >> 40)
	b[1] = byte(ms >> 32)
	b[2] = byte(ms >> 24)
	b[3] = byte(ms >> 16)
	b[4] = byte(ms >> 8)
	b[5] = byte(ms)

	// Set version to 7 (0111xxxx)
	b[6] = (b[6] & 0x0f) | 0x70
	// Set RFC4122 variant (10xxxxxx)
	b[8] = (b[8] & 0x3f) | 0x80

	hexBytes := make([]byte, 32)
	hex.Encode(hexBytes, b[:])
	return string(hexBytes[0:8]) + "-" + string(hexBytes[8:12]) + "-" + string(hexBytes[12:16]) + "-" + string(hexBytes[16:20]) + "-" + string(hexBytes[20:32])
}
