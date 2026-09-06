package httpapi

import "net/http"

const defaultMaxRequestBodyBytes int64 = 40 << 20

func (s *Server) withRequestLimits(next http.Handler) http.Handler {
	maxBodyBytes := s.maxRequestBodyBytes()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Transcription enforces its own 2 GB audio limit; chat accepts the resulting
		// transcript without an additional request-size cap. Both authorize first.
		if r.Method == http.MethodPost && (r.URL.Path == "/v1/assistant/transcriptions" || r.URL.Path == "/v1/assistant/chat") {
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
