package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

const aiLiveInstructions = `You are Mango AI's conversational voice. Be brief, natural and clear. Let the user interrupt. Delegate every email lookup, Process question and workflow task to the backend. Continue conversation while it works. Say only what backend results establish; never invent app data or completion. The backend holds workflow instructions and skills. Explain that each proposed change needs the user's approval in the panel; spoken agreement is not approval. Do not promise email sends, deletions or permission changes. Ask for missing context before delegating. Tell the user when the backend needs attention.`

func newAILiveClient() *http.Client {
	return &http.Client{Timeout: 45 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

// The browser receives an SDP answer only, never an application API key.
// Reference: https://developers.openai.com/api/reference/resources/live/methods/create
func (s *Server) handleAILive(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := aiRequestContext(w, r)
	defer cancel()
	r = r.WithContext(ctx)
	if r.Method != http.MethodPost {
		writeError(w, 405, "method_not_allowed")
		return
	}
	c, u, ok := s.aiOwner(w, r)
	if !ok {
		return
	}
	// Refuse billable voice if the agent's durable execution store is unavailable.
	if _, err := s.repo.ListAIAgentSessions(r.Context(), c, u); err != nil {
		aiError(w, err)
		return
	}
	var in struct {
		SDP string `json:"sdp"`
	}
	if !aiDecode(w, r, &in) {
		return
	}
	if len(in.SDP) == 0 || len(in.SDP) > 128<<10 {
		writeError(w, 400, "invalid_voice_offer")
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"session": map[string]any{"model": "gpt-live-1", "instructions": aiLiveInstructions, "delegation": map[string]string{"type": "client"}, "store": false,
			"client": map[string]any{"data_channel": map[string]any{"allowed_client_events": []string{"session.commentary.append", "session.thinking.append", "session.close", "session.input_audio.mute", "session.input_audio.unmute"}}}},
		"transport": map[string]string{"type": "webrtc", "sdp": in.SDP},
	})
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, s.aiLiveURL, bytes.NewReader(payload))
	if err != nil {
		writeError(w, 502, "voice_connection_failed")
		return
	}
	request.Header.Set("Authorization", "Bearer "+s.aiAPIKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := s.aiLiveClient.Do(request)
	if err != nil {
		writeError(w, 502, "Voice could not connect to OpenAI. Check the network and try again.")
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		writeError(w, 502, "OpenAI voice is unavailable. Check GPT-Live access, project API permissions and billing.")
		return
	}
	var answer struct {
		Session struct {
			ID string `json:"id"`
		} `json:"session"`
		Transport struct {
			Type string `json:"type"`
			SDP  string `json:"sdp"`
		} `json:"transport"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 256<<10)).Decode(&answer); err != nil || answer.Session.ID == "" || answer.Transport.Type != "webrtc" || answer.Transport.SDP == "" {
		writeError(w, 502, "invalid_voice_answer")
		return
	}
	writeJSON(w, 201, map[string]string{"session_id": answer.Session.ID, "sdp": answer.Transport.SDP})
}
