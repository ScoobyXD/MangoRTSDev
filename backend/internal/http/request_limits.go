package httpapi

import "net/http"

const defaultMaxRequestBodyBytes int64 = 40 << 20

func (s *Server) withRequestLimits(next http.Handler) http.Handler {
	maxBodyBytes := s.maxRequestBodyBytes()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Transcription streams raw audio and enforces the provider's own upload limit.
		if r.Method == http.MethodPost && r.URL.Path == "/v1/transcriptions" {
			next.ServeHTTP(w, r)
			return
		}
		if r.Body != nil && maxBodyBytes > 0 {
			if r.ContentLength > maxBodyBytes {
				writeError(w, http.StatusRequestEntityTooLarge, "request_body_too_large")
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) maxRequestBodyBytes() int64 {
	if s.maxBodyBytes > 0 {
		return s.maxBodyBytes
	}
	return defaultMaxRequestBodyBytes
}
