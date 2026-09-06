package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	transcriptionMaxAudioBytes     = 2_000_000_000
	transcriptionProviderTimeout   = 10 * time.Minute
	transcriptionHeartbeatInterval = 15 * time.Second
	transcriptionURL               = "https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true"
)

func newTranscriptionClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// Deepgram permits ten minutes of processing after the audio finishes uploading.
	transport.ResponseHeaderTimeout = transcriptionProviderTimeout
	return &http.Client{
		Transport: transport,
		// A fixed destination must never forward the provider credential through a redirect.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

type transcriptionEvent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	Code string `json:"code,omitempty"`
}

func (s *Server) handleTranscription(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	if !requireCompanyAccess(w, r, r.URL.Query().Get("company_id")) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if s.deepgramAPIKey == "" {
		writeError(w, http.StatusServiceUnavailable, "transcription_unavailable")
		return
	}
	if r.ContentLength > transcriptionMaxAudioBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "transcription_audio_too_large")
		return
	}
	contentType := r.Header.Get("Content-Type")
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || (mediaType != "audio/webm" && mediaType != "audio/ogg" && mediaType != "audio/mp4") {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_transcription_audio")
		return
	}
	controller := http.NewResponseController(w)
	// This route streams uploads and keepalives; other routes retain their deadlines.
	_ = controller.SetReadDeadline(time.Time{})
	_ = controller.SetWriteDeadline(time.Time{})
	if err := controller.EnableFullDuplex(); err != nil && !errors.Is(err, http.ErrNotSupported) {
		writeError(w, http.StatusInternalServerError, "transcription_failed")
		return
	}
	// Read one byte to reject empty recordings, then forward every byte without
	// retaining the recording in backend memory or writing it to temporary files.
	body := http.MaxBytesReader(nil, r.Body, transcriptionMaxAudioBytes)
	defer body.Close()
	first := make([]byte, 1)
	if _, err := io.ReadFull(body, first); err != nil {
		if errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "transcription_audio_empty")
		} else {
			writeError(w, http.StatusBadRequest, "invalid_transcription_audio")
		}
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	providerRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, transcriptionURL, io.MultiReader(bytes.NewReader(first), body))
	if err != nil {
		writeError(w, http.StatusBadGateway, "transcription_failed")
		return
	}
	providerRequest.ContentLength = r.ContentLength
	providerRequest.Header.Set("Authorization", "Token "+s.deepgramAPIKey)
	providerRequest.Header.Set("Content-Type", contentType)
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("X-Accel-Buffering", "no")
	encoder := json.NewEncoder(w)
	emit := func(event transcriptionEvent) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := encoder.Encode(event); err != nil {
			return err
		}
		return controller.Flush()
	}
	if err := emit(transcriptionEvent{Type: "progress"}); err != nil {
		return
	}
	result := make(chan transcriptionEvent, 1)
	go func() { result <- s.transcribeAudio(providerRequest) }()
	// Keep the browser, load balancer, and CDN connected while Deepgram processes.
	ticker := time.NewTicker(transcriptionHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case event := <-result:
			_ = emit(event)
			return
		case <-ticker.C:
			if err := emit(transcriptionEvent{Type: "progress"}); err != nil {
				return
			}
		}
	}
}

func (s *Server) transcribeAudio(request *http.Request) transcriptionEvent {
	failure := transcriptionEvent{Type: "error", Code: "transcription_failed"}
	response, err := s.transcriptionClient.Do(request)
	if err != nil {
		var sizeError *http.MaxBytesError
		var timeout net.Error
		switch {
		case errors.As(err, &sizeError):
			failure.Code = "transcription_audio_too_large"
		case errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &timeout) && timeout.Timeout()):
			failure.Code = "transcription_timed_out"
		}
		return failure
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		if response.StatusCode == http.StatusGatewayTimeout {
			failure.Code = "transcription_timed_out"
		}
		return failure
	}
	decoder := json.NewDecoder(response.Body)
	text, err := readTranscriptionJSON(decoder, []string{"results", "channels", "0", "alternatives", "0", "transcript"})
	if err != nil || text == nil {
		return failure
	}
	if _, err := decoder.Token(); err != io.EOF {
		return failure
	}
	transcript := strings.TrimSpace(*text)
	if transcript == "" {
		return transcriptionEvent{Type: "error", Code: "transcription_no_speech"}
	}
	return transcriptionEvent{Type: "result", Text: transcript}
}

// Walk the provider response one value at a time. Decode into a struct would
// first buffer the entire JSON response, including the much larger word metadata.
// A nil path discards a value; an empty path selects the transcript string.
func readTranscriptionJSON(decoder *json.Decoder, path []string) (*string, error) {
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	if text, ok := token.(string); ok && path != nil && len(path) == 0 {
		return &text, nil
	}
	delimiter, ok := token.(json.Delim)
	if !ok || (delimiter != '{' && delimiter != '[') {
		return nil, nil
	}
	var transcript *string
	for index := 0; decoder.More(); index++ {
		key := strconv.Itoa(index)
		if delimiter == '{' {
			property, err := decoder.Token()
			if err != nil {
				return nil, err
			}
			key = property.(string)
		}
		var next []string
		if len(path) > 0 && key == path[0] {
			next = path[1:]
		}
		text, err := readTranscriptionJSON(decoder, next)
		if err != nil {
			return nil, err
		}
		if text != nil {
			transcript = text
		}
	}
	_, err = decoder.Token()
	return transcript, err
}
