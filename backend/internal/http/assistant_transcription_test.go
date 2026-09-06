package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"
	"time"
)

type transcriptionTransport func(*http.Request) (*http.Response, error)

func (transport transcriptionTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return transport(r)
}

func transcriptionRequest(t *testing.T, audio []byte, contentType, extraField string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": {`form-data; name="audio"; filename="dictation"`},
		"Content-Type":        {contentType},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(audio); err != nil {
		t.Fatal(err)
	}
	if extraField != "" {
		if err := writer.WriteField(extraField, "untrusted-value"); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "/v1/assistant/transcriptions?company_id="+assistantTestCompany, &body)
	r.Header.Set("Authorization", "Bearer assistant-token")
	r.Header.Set("Content-Type", writer.FormDataContentType())
	return r
}

func transcriptionResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func TestAssistantTranscriptionUsesFixedProviderAndPreservesAudio(t *testing.T) {
	server, repo := assistantTestServer(t, nil)
	server.deepgramAPIKey = "fixture-deepgram-key"
	audio := []byte("complete-audio-including-final-chunk")
	calls := 0
	server.transcriptionClient.Transport = transcriptionTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodPost || r.URL.String() != "https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true" || r.Header.Get("Authorization") != "Token fixture-deepgram-key" || r.Header.Get("Content-Type") != "audio/webm;codecs=opus" {
			t.Error("incorrect fixed Deepgram request")
		}
		body, err := io.ReadAll(r.Body)
		if err != nil || !bytes.Equal(body, audio) {
			t.Error("provider must receive completed audio bytes unchanged")
		}
		return transcriptionResponse(200, `{"results":{"channels":[{"alternatives":[{"transcript":"  Call <Sam> tomorrow.  "}]}]}}`), nil
	})
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, transcriptionRequest(t, audio, "audio/webm;codecs=opus", ""))
	var result map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != 200 || result["text"] != "Call <Sam> tomorrow." || len(result) != 1 || calls != 1 {
		t.Fatalf("response=%d %s calls=%d", response.Code, response.Body.String(), calls)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Error("transcripts must not be cached")
	}
	processes, err := repo.ListLogicGates(assistantTestCompany)
	if err != nil || len(processes) != 0 {
		t.Fatal("dictation must not invoke assistant actions")
	}
}

func TestAssistantTranscriptionRejectsUnauthorizedAndInvalidUploads(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*http.Request)
		audio  []byte
		mime   string
		extra  string
		status int
	}{
		{name: "missing authentication", mutate: func(r *http.Request) { r.Header.Del("Authorization") }, status: 401},
		{name: "other company", mutate: func(r *http.Request) { r.URL.RawQuery = "company_id=91919191-9191-4191-8191-919191919191" }, status: 403},
		{name: "missing company", mutate: func(r *http.Request) { r.URL.RawQuery = "" }, status: 400},
		{name: "invalid company", mutate: func(r *http.Request) { r.URL.RawQuery = "company_id=invalid" }, status: 403},
		{name: "unsupported type", mime: "application/json", status: 415},
		{name: "empty audio", audio: []byte{}, status: 400},
		{name: "oversized audio", audio: bytes.Repeat([]byte{1}, transcriptionMaxAudioBytes+1), status: 413},
		{name: "chunked oversized audio", audio: bytes.Repeat([]byte{1}, transcriptionMaxAudioBytes+1), mutate: func(r *http.Request) { r.ContentLength = -1 }, status: 413},
		{name: "oversized request", mutate: func(r *http.Request) { r.ContentLength = transcriptionMaxUploadBytes + 1 }, status: 413},
		{name: "oversized chunked epilogue", mutate: func(r *http.Request) {
			r.Body = io.NopCloser(io.MultiReader(r.Body, strings.NewReader(strings.Repeat("x", transcriptionMaxUploadBytes))))
			r.ContentLength = -1
		}, status: 413},
		{name: "extra company field", extra: "company_id", status: 400},
		{name: "not multipart", mutate: func(r *http.Request) { r.Header.Set("Content-Type", "application/json") }, status: 400},
		{name: "wrong method", mutate: func(r *http.Request) { r.Method = http.MethodGet }, status: 405},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, _ := assistantTestServer(t, nil)
			server.deepgramAPIKey = "fixture-key"
			server.transcriptionClient.Transport = transcriptionTransport(func(*http.Request) (*http.Response, error) {
				t.Error("rejected request must not reach Deepgram")
				return nil, errors.New("unexpected provider call")
			})
			audio := test.audio
			if audio == nil {
				audio = []byte("audio")
			}
			contentType := test.mime
			if contentType == "" {
				contentType = "audio/mp4"
			}
			r := transcriptionRequest(t, audio, contentType, test.extra)
			if test.mutate != nil {
				test.mutate(r)
			}
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, r)
			if response.Code != test.status {
				t.Fatalf("response=%d %s; want %d", response.Code, response.Body.String(), test.status)
			}
		})
	}
}

func TestAssistantTranscriptionProviderFailuresAreBoundedAndPrivate(t *testing.T) {
	tests := []struct {
		name   string
		body   string
		status int
		want   int
		code   string
	}{
		{name: "provider failure", body: "private provider error fixture-key", status: 500, want: 502, code: "transcription_failed"},
		{name: "redirect", status: 302, want: 502, code: "transcription_failed"},
		{name: "malformed", body: "not json", status: 200, want: 502, code: "transcription_failed"},
		{name: "missing result", body: `{}`, status: 200, want: 502, code: "transcription_failed"},
		{name: "too large response", body: strings.Repeat("x", transcriptionMaxResponseBytes+1), status: 200, want: 502, code: "transcription_failed"},
		{name: "silence", body: `{"results":{"channels":[{"alternatives":[{"transcript":"  "}]}]}}`, status: 200, want: 422, code: "transcription_no_speech"},
		{name: "too long transcript", body: `{"results":{"channels":[{"alternatives":[{"transcript":"` + strings.Repeat("x", 8001) + `"}]}]}}`, status: 200, want: 422, code: "transcription_text_too_long"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, _ := assistantTestServer(t, nil)
			server.deepgramAPIKey = "fixture-key"
			calls := 0
			server.transcriptionClient.Transport = transcriptionTransport(func(*http.Request) (*http.Response, error) {
				calls++
				return transcriptionResponse(test.status, test.body), nil
			})
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, transcriptionRequest(t, []byte("audio"), "audio/ogg;codecs=opus", ""))
			if response.Code != test.want || !strings.Contains(response.Body.String(), test.code) || strings.Contains(response.Body.String(), "fixture-key") || calls != 1 {
				t.Fatalf("response=%d %s calls=%d", response.Code, response.Body.String(), calls)
			}
		})
	}
}

func TestAssistantTranscriptionMissingKeyIsUnavailable(t *testing.T) {
	server, _ := assistantTestServer(t, nil)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, transcriptionRequest(t, []byte("audio"), "audio/webm", ""))
	if response.Code != 503 || !strings.Contains(response.Body.String(), "transcription_unavailable") {
		t.Fatalf("response=%d %s", response.Code, response.Body.String())
	}
}

func TestAssistantTranscriptionTimeoutAndCancellationStopProvider(t *testing.T) {
	for _, cancelRequest := range []bool{false, true} {
		name := "timeout"
		if cancelRequest {
			name = "canceled"
		}
		t.Run(name, func(t *testing.T) {
			server, _ := assistantTestServer(t, nil)
			server.deepgramAPIKey = "fixture-key"
			server.transcriptionClient.Timeout = 25 * time.Millisecond
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			server.transcriptionClient.Transport = transcriptionTransport(func(r *http.Request) (*http.Response, error) {
				if cancelRequest {
					cancel()
				}
				<-r.Context().Done()
				return nil, r.Context().Err()
			})
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, transcriptionRequest(t, []byte("audio"), "audio/webm", "").WithContext(ctx))
			if cancelRequest {
				if response.Body.Len() != 0 {
					t.Fatalf("canceled request returned stale output: %s", response.Body.String())
				}
			} else if response.Code != 504 || !strings.Contains(response.Body.String(), "transcription_timed_out") {
				t.Fatalf("response=%d %s", response.Code, response.Body.String())
			}
		})
	}
}

type transcriptionDeadlineWriter struct{ http.ResponseWriter }

func (w transcriptionDeadlineWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w transcriptionDeadlineWriter) SetReadDeadline(deadline time.Time) error {
	if !deadline.IsZero() {
		deadline = time.Now().Add(100 * time.Millisecond)
	}
	return http.NewResponseController(w.ResponseWriter).SetReadDeadline(deadline)
}

func TestAssistantTranscriptionHTTPFinishesUploadBeforeProviderDeadline(t *testing.T) {
	server, _ := assistantTestServer(t, nil)
	server.deepgramAPIKey = "fixture-key"
	server.transcriptionClient.Transport = transcriptionTransport(func(r *http.Request) (*http.Response, error) {
		select {
		case <-time.After(150 * time.Millisecond):
			return transcriptionResponse(200, `{"results":{"channels":[{"alternatives":[{"transcript":"Ready for review."}]}]}}`), nil
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
	})
	routes := server.Routes()
	api := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		routes.ServeHTTP(transcriptionDeadlineWriter{w}, r)
	}))
	api.Config.WriteTimeout = 5 * time.Millisecond
	api.Config.ReadTimeout = 15 * time.Second
	api.EnableHTTP2 = true
	api.StartTLS()
	t.Cleanup(api.Close)
	request := transcriptionRequest(t, []byte("complete recorded audio"), "audio/mp4", "")
	clientRequest, err := http.NewRequest(http.MethodPost, api.URL+request.URL.RequestURI(), request.Body)
	if err != nil {
		t.Fatal(err)
	}
	clientRequest.Header = request.Header
	clientRequest.ContentLength = request.ContentLength
	response, err := api.Client().Do(clientRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.ProtoMajor != 2 {
		t.Fatal("must exercise HTTP/2 stream deadlines after upload")
	}
	body, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != 200 || !strings.Contains(string(body), "Ready for review.") {
		t.Fatalf("local HTTP response=%d %s error=%v", response.StatusCode, body, err)
	}
	if api.Config.WriteTimeout != 5*time.Millisecond || api.Config.ReadTimeout != 15*time.Second {
		t.Fatal("dictation must not change global server timeouts")
	}
}
