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
	"strings"
	"time"
	"unicode/utf8"
)

const (
	transcriptionMaxAudioBytes    = 8 << 20
	transcriptionMaxUploadBytes   = transcriptionMaxAudioBytes + (64 << 10)
	transcriptionMaxResponseBytes = 1 << 20
	transcriptionProviderTimeout  = 20 * time.Second
	transcriptionURL              = "https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true"
)

func newTranscriptionClient() *http.Client {
	return &http.Client{
		Timeout: transcriptionProviderTimeout,
		// A fixed destination must never forward the provider credential through a redirect.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func (s *Server) handleAssistantTranscription(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 32*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	// Limit this upload independently of the server's general request timeouts.
	controller := http.NewResponseController(w)
	_ = controller.SetReadDeadline(time.Now().Add(10 * time.Second))
	_ = controller.SetWriteDeadline(time.Now().Add(35 * time.Second))
	if _, ok := s.requireAssistantActor(w, r); !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if s.deepgramAPIKey == "" {
		writeError(w, http.StatusServiceUnavailable, "transcription_unavailable")
		return
	}
	if r.ContentLength > transcriptionMaxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "transcription_audio_too_large")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, transcriptionMaxUploadBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_transcription_audio")
		return
	}
	part, err := reader.NextPart()
	if err != nil {
		writeTranscriptionUploadError(w, err)
		return
	}
	if part.FormName() != "audio" {
		writeError(w, http.StatusBadRequest, "invalid_transcription_audio")
		return
	}
	contentType := part.Header.Get("Content-Type")
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || (mediaType != "audio/webm" && mediaType != "audio/ogg" && mediaType != "audio/mp4") {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_transcription_audio")
		return
	}
	// MultipartReader and a bounded read keep audio in memory; ParseMultipartForm can write files.
	audio, err := io.ReadAll(io.LimitReader(part, transcriptionMaxAudioBytes+1))
	if err != nil {
		writeTranscriptionUploadError(w, err)
		return
	}
	if len(audio) > transcriptionMaxAudioBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "transcription_audio_too_large")
		return
	}
	if len(audio) == 0 {
		writeError(w, http.StatusBadRequest, "transcription_audio_empty")
		return
	}
	if _, err = reader.NextPart(); err != io.EOF {
		writeTranscriptionUploadError(w, err)
		return
	}
	// Finish the bounded HTTP body too, including any multipart epilogue.
	if _, err = io.Copy(io.Discard, r.Body); err != nil {
		writeTranscriptionUploadError(w, err)
		return
	}
	_ = controller.SetReadDeadline(time.Time{})
	providerRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, transcriptionURL, bytes.NewReader(audio))
	if err != nil {
		writeError(w, http.StatusBadGateway, "transcription_failed")
		return
	}
	providerRequest.Header.Set("Authorization", "Token "+s.deepgramAPIKey)
	providerRequest.Header.Set("Content-Type", contentType)
	response, err := s.transcriptionClient.Do(providerRequest)
	if err != nil {
		if r.Context().Err() == context.Canceled {
			return
		}
		var timeout net.Error
		if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &timeout) && timeout.Timeout()) {
			writeError(w, http.StatusGatewayTimeout, "transcription_timed_out")
		} else {
			writeError(w, http.StatusBadGateway, "transcription_failed")
		}
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, "transcription_failed")
		return
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, transcriptionMaxResponseBytes+1))
	if err != nil || len(data) > transcriptionMaxResponseBytes {
		writeError(w, http.StatusBadGateway, "transcription_failed")
		return
	}
	var result struct {
		Results struct {
			Channels []struct {
				Alternatives []struct {
					Transcript string `json:"transcript"`
				} `json:"alternatives"`
			} `json:"channels"`
		} `json:"results"`
	}
	if json.Unmarshal(data, &result) != nil || len(result.Results.Channels) != 1 || len(result.Results.Channels[0].Alternatives) == 0 {
		writeError(w, http.StatusBadGateway, "transcription_failed")
		return
	}
	text := strings.TrimSpace(result.Results.Channels[0].Alternatives[0].Transcript)
	if text == "" {
		writeError(w, http.StatusUnprocessableEntity, "transcription_no_speech")
		return
	}
	if utf8.RuneCountInString(text) > 8000 {
		writeError(w, http.StatusUnprocessableEntity, "transcription_text_too_long")
		return
	}
	if ctx.Err() != nil {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"text": text})
}

func writeTranscriptionUploadError(w http.ResponseWriter, err error) {
	var sizeError *http.MaxBytesError
	var timeout net.Error
	switch {
	case errors.As(err, &sizeError):
		writeError(w, http.StatusRequestEntityTooLarge, "transcription_audio_too_large")
	case errors.As(err, &timeout) && timeout.Timeout():
		writeError(w, http.StatusRequestTimeout, "transcription_upload_timed_out")
	default:
		writeError(w, http.StatusBadRequest, "invalid_transcription_audio")
	}
}
