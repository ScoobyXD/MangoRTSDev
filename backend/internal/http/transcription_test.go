package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

const transcriptionTestCompany = "81818181-8181-4181-8181-818181818181"

func transcriptionTestServer(t *testing.T) (*Server, *store.MemoryRepo) {
	t.Helper()
	repo := store.NewMemoryRepo()
	repo.EnsureCompany(transcriptionTestCompany, "Transcription tests")
	user := mustRealtimeAuthUser(t, repo, transcriptionTestCompany, "transcription-user", domain.RoleCompanyUser)
	server := newRealtimeAuthServerForTest(repo, "transcription-token", user)
	t.Cleanup(server.Close)
	return server, repo
}

type transcriptionTransport func(*http.Request) (*http.Response, error)

func (transport transcriptionTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return transport(r)
}

func transcriptionRequest(t *testing.T, audio []byte, contentType string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/v1/transcriptions?company_id="+transcriptionTestCompany, bytes.NewReader(audio))
	r.Header.Set("Authorization", "Bearer transcription-token")
	r.Header.Set("Content-Type", contentType)
	return r
}

func transcriptionResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func transcriptionEvents(t *testing.T, response *httptest.ResponseRecorder) []transcriptionEvent {
	t.Helper()
	decoder := json.NewDecoder(response.Body)
	var events []transcriptionEvent
	for {
		var event transcriptionEvent
		err := decoder.Decode(&event)
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		events = append(events, event)
	}
	if response.Code != 200 || len(events) < 1 || events[0].Type != "progress" {
		t.Fatalf("response=%d events=%+v", response.Code, events)
	}
	return events
}

func TestTranscriptionUsesFixedProviderAndPreservesAudio(t *testing.T) {
	server, repo := transcriptionTestServer(t)
	server.deepgramAPIKey = "fixture-deepgram-key"
	audio := []byte("complete-audio-including-final-chunk")
	calls := 0
	server.transcriptionClient.Transport = transcriptionTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodPost || r.URL.String() != "https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true" || r.Header.Get("Authorization") != "Token fixture-deepgram-key" || r.Header.Get("Content-Type") != "audio/webm;codecs=opus" {
			t.Error("incorrect fixed Deepgram request")
		}
		body, err := io.ReadAll(r.Body)
		if err != nil || !bytes.Equal(body, audio) || r.ContentLength != int64(len(audio)) {
			t.Error("provider must receive completed audio bytes and length unchanged")
		}
		return transcriptionResponse(200, `{"results":{"channels":[{"alternatives":[{"transcript":"  Call <Sam> tomorrow.  "}]}]}}`), nil
	})
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, transcriptionRequest(t, audio, "audio/webm;codecs=opus"))
	events := transcriptionEvents(t, response)
	if len(events) != 2 || events[1].Type != "result" || events[1].Text != "Call <Sam> tomorrow." || calls != 1 {
		t.Fatalf("events=%+v calls=%d", events, calls)
	}
	if response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Content-Type") != "application/x-ndjson" {
		t.Error("transcripts must be streamed without caching")
	}
	processes, err := repo.ListLogicGates(transcriptionTestCompany)
	if err != nil || len(processes) != 0 {
		t.Fatal("dictation must not create app processes")
	}
}

func TestTranscriptionRejectsUnauthorizedAndInvalidUploads(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*http.Request)
		audio  []byte
		mime   string
		status int
	}{
		{name: "missing authentication", mutate: func(r *http.Request) { r.Header.Del("Authorization") }, status: 401},
		{name: "other company", mutate: func(r *http.Request) { r.URL.RawQuery = "company_id=91919191-9191-4191-8191-919191919191" }, status: 403},
		{name: "missing company", mutate: func(r *http.Request) { r.URL.RawQuery = "" }, status: 400},
		{name: "invalid company", mutate: func(r *http.Request) { r.URL.RawQuery = "company_id=invalid" }, status: 403},
		{name: "unsupported type", mime: "application/json", status: 415},
		{name: "obsolete multipart", mime: "multipart/form-data; boundary=fixture", status: 415},
		{name: "empty audio", audio: []byte{}, status: 400},
		{name: "oversized request", mutate: func(r *http.Request) { r.ContentLength = transcriptionMaxAudioBytes + 1 }, status: 413},
		{name: "wrong method", mutate: func(r *http.Request) { r.Method = http.MethodGet }, status: 405},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, _ := transcriptionTestServer(t)
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
			r := transcriptionRequest(t, audio, contentType)
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

type generatedTranscriptionAudio struct {
	remaining int64
	readBytes int64
	maxRead   int
}

func (audio *generatedTranscriptionAudio) Read(p []byte) (int, error) {
	if audio.remaining == 0 {
		return 0, io.EOF
	}
	n := min(int64(len(p)), audio.remaining)
	clear(p[:n])
	audio.remaining -= n
	audio.readBytes += n
	audio.maxRead = max(audio.maxRead, len(p))
	return int(n), nil
}

func TestTranscriptionStreamsTwoGBAndRejectsChunkedOverflow(t *testing.T) {
	for _, extra := range []int64{0, 1} {
		name := "exactly two GB"
		if extra != 0 {
			name = "chunked one byte over two GB"
		}
		t.Run(name, func(t *testing.T) {
			server, _ := transcriptionTestServer(t)
			server.deepgramAPIKey = "fixture-key"
			audio := &generatedTranscriptionAudio{remaining: transcriptionMaxAudioBytes + extra}
			server.transcriptionClient.Transport = transcriptionTransport(func(r *http.Request) (*http.Response, error) {
				if audio.readBytes != 1 {
					t.Error("handler buffered audio before calling the provider")
				}
				n, err := io.Copy(io.Discard, r.Body)
				if n != transcriptionMaxAudioBytes {
					t.Errorf("forwarded %d bytes, want exactly %d", n, transcriptionMaxAudioBytes)
				}
				if extra != 0 {
					var sizeError *http.MaxBytesError
					if !errors.As(err, &sizeError) {
						t.Errorf("missing stream size error: %v", err)
					}
					return nil, err
				}
				if err != nil {
					t.Error(err)
				}
				return transcriptionResponse(200, `{"results":{"channels":[{"alternatives":[{"transcript":"Complete."}]}]}}`), nil
			})
			r := transcriptionRequest(t, []byte("unused"), "audio/webm")
			r.Body = io.NopCloser(audio)
			r.ContentLength = transcriptionMaxAudioBytes
			if extra != 0 {
				r.ContentLength = -1
			}
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, r)
			events := transcriptionEvents(t, response)
			last := events[len(events)-1]
			if extra == 0 && (last.Type != "result" || last.Text != "Complete.") {
				t.Fatalf("exact 2GB rejected: %+v", last)
			}
			if extra != 0 && (last.Type != "error" || last.Code != "transcription_audio_too_large") {
				t.Fatalf("overflow accepted: %+v", last)
			}
			if audio.maxRead > 64<<10 {
				t.Fatalf("large recording requires a %d-byte read buffer", audio.maxRead)
			}
		})
	}
}

func TestTranscriptionProviderFailuresArePrivate(t *testing.T) {
	tests := []struct {
		name   string
		body   string
		status int
		code   string
	}{
		{name: "provider failure", body: "private provider error fixture-key", status: 500, code: "transcription_failed"},
		{name: "provider processing timeout", status: 504, code: "transcription_timed_out"},
		{name: "redirect", status: 302, code: "transcription_failed"},
		{name: "malformed", body: "not json", status: 200, code: "transcription_failed"},
		{name: "missing result", body: `{}`, status: 200, code: "transcription_failed"},
		{name: "wrong transcript type", body: `{"results":{"channels":[{"alternatives":[{"transcript":123}]}]}}`, status: 200, code: "transcription_failed"},
		{name: "trailing data", body: `{"results":{"channels":[{"alternatives":[{"transcript":"Ready"}]}]}}{}`, status: 200, code: "transcription_failed"},
		{name: "silence", body: `{"results":{"channels":[{"alternatives":[{"transcript":"  "}]}]}}`, status: 200, code: "transcription_no_speech"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, _ := transcriptionTestServer(t)
			server.deepgramAPIKey = "fixture-key"
			server.transcriptionClient.Transport = transcriptionTransport(func(*http.Request) (*http.Response, error) {
				return transcriptionResponse(test.status, test.body), nil
			})
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, transcriptionRequest(t, []byte("audio"), "audio/ogg;codecs=opus"))
			events := transcriptionEvents(t, response)
			last := events[len(events)-1]
			if last.Type != "error" || last.Code != test.code || strings.Contains(last.Code, "fixture-key") {
				t.Fatalf("terminal event=%+v", last)
			}
		})
	}
}

func TestTranscriptionAcceptsLongTranscriptAndLargeWordMetadata(t *testing.T) {
	server, _ := transcriptionTestServer(t)
	server.deepgramAPIKey = "fixture-key"
	longText := strings.Repeat("Long dictation. ", 1500)
	metadata := strings.Repeat(`{"word":"fixture","start":1,"end":2},`, 40000) + `{"word":"last"}`
	server.transcriptionClient.Transport = transcriptionTransport(func(*http.Request) (*http.Response, error) {
		return transcriptionResponse(200, `{"metadata":{"ignored":["nested",{"value":null}]},"results":{"channels":[{"alternatives":[{"transcript":"`+longText+`","words":[`+metadata+`]}]}]}}`), nil
	})
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, transcriptionRequest(t, []byte("audio"), "audio/webm"))
	events := transcriptionEvents(t, response)
	if len(events) != 2 || events[1].Type != "result" || events[1].Text != strings.TrimSpace(longText) {
		t.Fatal("valid long transcript or word metadata was rejected")
	}
}

func TestTranscriptionMissingKeyIsUnavailable(t *testing.T) {
	server, _ := transcriptionTestServer(t)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, transcriptionRequest(t, []byte("audio"), "audio/webm"))
	if response.Code != 503 || !strings.Contains(response.Body.String(), "transcription_unavailable") {
		t.Fatalf("response=%d %s", response.Code, response.Body.String())
	}
}

func TestTranscriptionTimeoutAndCancellationStopProvider(t *testing.T) {
	for _, cancelRequest := range []bool{false, true} {
		name := "timeout"
		if cancelRequest {
			name = "canceled"
		}
		t.Run(name, func(t *testing.T) {
			server, _ := transcriptionTestServer(t)
			server.deepgramAPIKey = "fixture-key"
			server.transcriptionClient.Timeout = 25 * time.Millisecond
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			stopped := make(chan struct{})
			server.transcriptionClient.Transport = transcriptionTransport(func(r *http.Request) (*http.Response, error) {
				defer close(stopped)
				if cancelRequest {
					cancel()
				}
				<-r.Context().Done()
				return nil, r.Context().Err()
			})
			response := httptest.NewRecorder()
			server.Routes().ServeHTTP(response, transcriptionRequest(t, []byte("audio"), "audio/webm").WithContext(ctx))
			events := transcriptionEvents(t, response)
			if cancelRequest {
				if len(events) != 1 {
					t.Fatalf("canceled request returned stale output: %+v", events)
				}
			} else if len(events) != 2 || events[1].Code != "transcription_timed_out" {
				t.Fatalf("events=%+v", events)
			}
			select {
			case <-stopped:
			case <-time.After(time.Second):
				t.Fatal("provider did not stop after cancellation")
			}
		})
	}
}

func TestTranscriptionProviderTimeoutStartsAfterUpload(t *testing.T) {
	client := newTranscriptionClient()
	if client.Timeout != 0 {
		t.Fatal("a total request timeout would cut off slow large uploads")
	}
	transport := client.Transport.(*http.Transport).Clone()
	if transport.ResponseHeaderTimeout != 10*time.Minute {
		t.Fatal("provider processing timeout must match Deepgram's ten-minute limit")
	}
	transport.ResponseHeaderTimeout = 50 * time.Millisecond
	client.Transport = transport
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		_, _ = io.WriteString(w, "complete")
	}))
	defer provider.Close()
	reader, writer := io.Pipe()
	go func() {
		_, _ = writer.Write([]byte("first"))
		time.Sleep(100 * time.Millisecond)
		_, _ = writer.Write([]byte("last"))
		_ = writer.Close()
	}()
	request, err := http.NewRequest(http.MethodPost, provider.URL, reader)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("upload incorrectly consumed provider processing timeout: %v", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || string(body) != "complete" {
		t.Fatalf("body=%s error=%v", body, err)
	}
}

func TestTranscriptionHTTPFullDuplexClearsOnlyRouteDeadlines(t *testing.T) {
	const routeTimeout = 500 * time.Millisecond
	for _, useHTTP2 := range []bool{false, true} {
		name := "HTTP1"
		if useHTTP2 {
			name = "HTTP2"
		}
		t.Run(name, func(t *testing.T) {
			server, _ := transcriptionTestServer(t)
			server.deepgramAPIKey = "fixture-key"
			server.transcriptionClient.Transport = transcriptionTransport(func(r *http.Request) (*http.Response, error) {
				body, err := io.ReadAll(r.Body)
				if err != nil || string(body) != "first-last" {
					t.Errorf("streamed upload=%s error=%v", body, err)
				}
				select {
				case <-time.After(50 * time.Millisecond):
					return transcriptionResponse(200, `{"results":{"channels":[{"alternatives":[{"transcript":"Ready for review."}]}]}}`), nil
				case <-r.Context().Done():
					return nil, r.Context().Err()
				}
			})
			api := httptest.NewUnstartedServer(server.Routes())
			// Allow TLS to connect before testing an upload that exceeds both deadlines.
			api.Config.WriteTimeout = routeTimeout
			api.Config.ReadTimeout = routeTimeout
			api.EnableHTTP2 = useHTTP2
			api.StartTLS()
			defer api.Close()
			reader, writer := io.Pipe()
			defer writer.Close()
			request := transcriptionRequest(t, nil, "audio/mp4")
			clientRequest, err := http.NewRequest(http.MethodPost, api.URL+request.URL.RequestURI(), reader)
			if err != nil {
				t.Fatal(err)
			}
			clientRequest.Header = request.Header
			responseReady := make(chan *http.Response, 1)
			requestFailed := make(chan error, 1)
			go func() {
				response, err := api.Client().Do(clientRequest)
				if err != nil {
					requestFailed <- err
					return
				}
				responseReady <- response
			}()
			if _, err := writer.Write([]byte("first")); err != nil {
				t.Fatal(err)
			}
			var response *http.Response
			select {
			case response = <-responseReady:
			case err := <-requestFailed:
				t.Fatal(err)
			case <-time.After(3 * time.Second):
				t.Fatal("server buffered the upload before sending progress")
			}
			defer response.Body.Close()
			if (response.ProtoMajor == 2) != useHTTP2 {
				t.Fatalf("wrong HTTP version: %s", response.Proto)
			}
			decoder := json.NewDecoder(response.Body)
			var progress transcriptionEvent
			if err := decoder.Decode(&progress); err != nil || progress.Type != "progress" {
				t.Fatalf("missing progress during upload: %+v error=%v", progress, err)
			}
			time.Sleep(2 * routeTimeout)
			if _, err := writer.Write([]byte("-last")); err != nil {
				t.Fatal(err)
			}
			_ = writer.Close()
			var result transcriptionEvent
			if err := decoder.Decode(&result); err != nil || result.Type != "result" || result.Text != "Ready for review." {
				t.Fatalf("result=%+v error=%v", result, err)
			}
			if api.Config.WriteTimeout != routeTimeout || api.Config.ReadTimeout != routeTimeout {
				t.Fatal("dictation must not change global server timeouts")
			}
		})
	}
}

func TestTranscriptionKeepsConnectionAliveDuringProcessing(t *testing.T) {
	server, _ := transcriptionTestServer(t)
	server.deepgramAPIKey = "fixture-key"
	finishProcessing := make(chan struct{})
	server.transcriptionClient.Transport = transcriptionTransport(func(r *http.Request) (*http.Response, error) {
		_, _ = io.Copy(io.Discard, r.Body)
		select {
		case <-finishProcessing:
			return transcriptionResponse(200, `{"results":{"channels":[{"alternatives":[{"transcript":"Finished."}]}]}}`), nil
		case <-r.Context().Done():
			return nil, r.Context().Err()
		}
	})
	api := httptest.NewServer(server.Routes())
	defer api.Close()
	ctx, cancel := context.WithTimeout(context.Background(), transcriptionHeartbeatInterval+5*time.Second)
	defer cancel()
	request := transcriptionRequest(t, []byte("audio"), "audio/webm")
	clientRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, api.URL+request.URL.RequestURI(), request.Body)
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
	decoder := json.NewDecoder(response.Body)
	for index := 0; index < 2; index++ {
		var event transcriptionEvent
		if err := decoder.Decode(&event); err != nil || event.Type != "progress" {
			t.Fatalf("keepalive %d=%+v error=%v", index, event, err)
		}
	}
	close(finishProcessing)
	var event transcriptionEvent
	if err := decoder.Decode(&event); err != nil || event.Type != "result" || event.Text != "Finished." {
		t.Fatalf("terminal event=%+v error=%v", event, err)
	}
}

func TestTranscriptionDisconnectDuringUploadReleasesProviderAndHandler(t *testing.T) {
	server, _ := transcriptionTestServer(t)
	server.deepgramAPIKey = "fixture-key"
	providerStopped := make(chan struct{})
	server.transcriptionClient.Transport = transcriptionTransport(func(r *http.Request) (*http.Response, error) {
		defer close(providerStopped)
		_, err := io.Copy(io.Discard, r.Body)
		if err == nil {
			t.Error("canceled upload should not finish normally")
		}
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	handlerStopped := make(chan struct{})
	routes := server.Routes()
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(handlerStopped)
		routes.ServeHTTP(w, r)
	}))
	defer api.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reader, writer := io.Pipe()
	defer writer.Close()
	request := transcriptionRequest(t, nil, "audio/webm")
	clientRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, api.URL+request.URL.RequestURI(), reader)
	if err != nil {
		t.Fatal(err)
	}
	clientRequest.Header = request.Header
	go func() { _, _ = writer.Write([]byte("recorded audio, with upload still open")) }()
	response, err := api.Client().Do(clientRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var progress transcriptionEvent
	if err := json.NewDecoder(response.Body).Decode(&progress); err != nil || progress.Type != "progress" {
		t.Fatalf("progress=%+v error=%v", progress, err)
	}
	cancel()
	for _, stopped := range []<-chan struct{}{providerStopped, handlerStopped} {
		select {
		case <-stopped:
		case <-time.After(3 * time.Second):
			t.Fatal("browser cancellation left an upload or handler running")
		}
	}
}
