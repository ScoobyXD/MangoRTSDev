package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func assistantRuntimePaths() (string, string) {
	node, _ := exec.LookPath("node")
	if node != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		version, err := exec.CommandContext(ctx, node, "--version").Output()
		cancel()
		var major, minor int
		if _, parseErr := fmt.Sscanf(string(version), "v%d.%d", &major, &minor); err != nil || parseErr != nil || major < 22 || (major == 22 && minor < 19) {
			node = ""
		}
	}
	root := os.Getenv("MANGORTS_AI_ROOT")
	if root != "" {
		return filepath.Join(root, "runtime", "main.mjs"), node
	}
	directory, _ := os.Getwd()
	for directory != "" {
		candidate := filepath.Join(directory, "ai", "runtime", "main.mjs")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, node
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			break
		}
		directory = parent
	}
	return "", node
}

func (a *mangoAssistant) available() bool {
	if a.nodePath == "" || a.runtimePath == "" {
		return false
	}
	if info, err := os.Stat(a.runtimePath); err != nil || !info.Mode().IsRegular() {
		return false
	}
	_, err := os.Stat(filepath.Join(filepath.Dir(a.runtimePath), "node_modules", "@earendil-works", "pi-coding-agent", "package.json"))
	return err == nil
}

// Deliberately exclude inherited provider/cloud credentials and developer settings.
// The only provider credential crosses the private stdin pipe in the start frame.
func assistantChildEnvironment() []string {
	result := []string{}
	for _, key := range []string{"PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"} {
		if value, ok := os.LookupEnv(key); ok {
			result = append(result, key+"="+value)
		}
	}
	return append(result, "NODE_ENV=production")
}

type assistantBridgeMessage struct {
	Type      string          `json:"type"`
	ID        string          `json:"id"`
	CallID    string          `json:"call_id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
	Text      string          `json:"text"`
	Message   string          `json:"message"`
	Event     struct {
		Kind   string          `json:"kind"`
		Status string          `json:"status"`
		Data   json.RawMessage `json:"data"`
	} `json:"event"`
}

func assistantCatalog(process *assistantProcessExecution) []assistantFunctionTool {
	if process == nil {
		return append(assistantTools(), assistantBindingTools()...)
	}
	if process.definition.ExecutionBlockedReason != "" {
		return []assistantFunctionTool{}
	}
	return assistantProcessTools()
}

func assistantReadOnlyTool(name string) bool {
	if name == "get_attachment_upload" {
		return false
	} // May synchronize parts or clean up lost access.
	return strings.HasPrefix(name, "get_") || strings.HasPrefix(name, "list_") || name == "bind_process"
}

func (s *Server) runAssistant(r *http.Request, request assistantRequest, emit func(assistantEvent) error) (runErr error) {
	a := s.assistant
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stopShutdown := context.AfterFunc(a.shutdown, cancel)
	defer stopShutdown()
	r = r.WithContext(ctx)
	actor, ok := authenticatedActor(r)
	if !ok {
		return assistantActionError{errors.New("Sign in before using Mango chat.")}
	}
	defer func() { s.finishAssistantCapture(r, request, emit, runErr) }()
	role, err := s.currentActorRoleForCompanyContext(ctx, actor, actor.CompanyID)
	if err != nil || role == "" {
		return assistantActionError{errors.New("Your company access could not be verified.")}
	}
	key := actor.CompanyID + ":" + actor.User.UserID + ":" + request.RequestID
	a.mu.Lock()
	capture := a.captures[key]
	if capture == nil {
		a.mu.Unlock()
		return errors.New("assistant_capture_not_admitted")
	}
	capture.inspect = request.InspectContext
	a.mu.Unlock()
	record := func(kind, status string, data any) error {
		return s.captureAssistant(r, capture, emit, kind, status, data)
	}
	trackedEmit := func(event assistantEvent) error {
		a.recordAssistantResult(key, event)
		if event.Type == "node" {
			// A lost browser connection cannot erase a confirmed saved Node identity.
			_ = emit(event)
			return nil
		}
		return emit(event)
	}
	inputContext := map[string]any{"identity": assistantUserContext(actor, role)}
	var process *assistantProcessExecution
	if request.ProcessID != "" {
		process, err = s.bindAssistantProcess(r, request.ProcessID, trackedEmit)
		if err != nil {
			return assistantActionError{err}
		}
		inputContext["process"] = process.definition
	}
	if err = record("context", "completed", inputContext); err != nil {
		return err
	}
	command := exec.CommandContext(ctx, a.nodePath, a.runtimePath)
	command.Dir = filepath.Dir(a.runtimePath)
	command.Env = assistantChildEnvironment()
	command.WaitDelay = 2 * time.Second
	// No inherited stderr: SDK/provider errors can include private data.
	command.Stderr = io.Discard
	stdin, err := command.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return err
	}
	if err = command.Start(); err != nil {
		return assistantActionError{errors.New("Pi could not start. Install the packaged AI runtime and Node 22.19 or newer.")}
	}
	defer func() { _ = stdin.Close(); _ = command.Process.Kill(); _ = command.Wait() }()
	encoder := json.NewEncoder(stdin)
	contextAndHistory, _ := json.Marshal(map[string]any{"context": inputContext, "messages": request.Messages})
	var cleanInput any
	_ = json.Unmarshal(contextAndHistory, &cleanInput)
	clean := assistantSanitize(cleanInput, a.apiKey).(map[string]any)
	start := map[string]any{
		"type": "start", "api_key": a.apiKey, "model": a.model, "base_url": a.baseURL,
		"reasoning_effort": request.ReasoningEffort, "messages": clean["messages"],
		"context": clean["context"], "tools": assistantCatalog(process),
		"limits": map[string]int{"tools": assistantMaxSteps, "responses": assistantMaxSteps + 1, "output_bytes": assistantMaxOutputBytes, "context_bytes": 512000, "trace_bytes": assistantTraceLimit},
	}
	if err = encoder.Encode(start); err != nil {
		return err
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64<<10), assistantTraceLimit)
	seenCalls, seenWrites := map[string]bool{}, map[string]bool{}
	toolCount, outputBytes := 0, 0
	for scanner.Scan() {
		if err = ctx.Err(); err != nil {
			return err
		}
		var frame assistantBridgeMessage
		if json.Unmarshal(scanner.Bytes(), &frame) != nil {
			return errors.New("invalid_pi_frame")
		}
		switch frame.Type {
		case "capture":
			if frame.ID == "" || frame.Event.Kind == "" || frame.Event.Status == "" || len(frame.Event.Data) == 0 {
				return errors.New("invalid_pi_capture")
			}
			if err = record(frame.Event.Kind, frame.Event.Status, frame.Event.Data); err != nil {
				return err
			}
			if err = encoder.Encode(map[string]any{"type": "ack", "id": frame.ID}); err != nil {
				return err
			}
		case "text":
			outputBytes += len(frame.Text)
			if outputBytes > assistantMaxOutputBytes {
				return assistantActionError{errors.New("Chat reached its output limit. Completed changes remain.")}
			}
			if err = emit(assistantEvent{Type: "text", Text: frame.Text}); err != nil {
				return err
			}
		case "tool":
			data := map[string]any{"call_id": frame.CallID, "name": frame.Name, "arguments": frame.Arguments}
			if err = record("tool", "prepared", data); err != nil {
				return err
			}
			toolCount++
			providerCallID, _, _ := strings.Cut(frame.CallID, "|")
			args, validationErr := assistantArgumentsForTools(assistantCatalog(process), frame.Name, string(frame.Arguments))
			if frame.ID == "" || providerCallID == "" || seenCalls[providerCallID] || toolCount > assistantMaxSteps {
				validationErr = errors.New("Chat reached its tool limit or received a repeated call. Further work stopped.")
			}
			seenCalls[providerCallID] = true
			if validationErr == nil && strings.HasPrefix(frame.Name, "delete_") && (frame.Name == "delete_process" || frame.Name == "delete_node" || frame.Name == "delete_folder") {
				confirmation, _ := args["confirmation_display_name"].(string)
				confirmed := false
				for _, line := range strings.Split(request.Messages[len(request.Messages)-1].Content, "\n") {
					confirmed = confirmed || strings.EqualFold(strings.TrimSpace(line), strings.TrimSpace(confirmation))
				}
				if strings.TrimSpace(confirmation) == "" || !confirmed {
					validationErr = errors.New("Deletion stopped. Type your confirmation display name on its own line in your next message to confirm the deletion.")
				}
			}
			if validationErr == nil && !assistantReadOnlyTool(frame.Name) {
				canonical, _ := json.Marshal(args)
				writeKey := frame.Name + ":" + string(canonical)
				if process != nil {
					writeKey = fmt.Sprintf("%s:%s:%d:%s", process.nodeID, process.stepID, process.assignmentVersion, writeKey)
				}
				if seenWrites[writeKey] {
					validationErr = errors.New("A repeated write was stopped. Check saved work before trying again.")
				}
				seenWrites[writeKey] = true
			}
			if validationErr != nil {
				data["error"] = validationErr.Error()
				_ = record("tool", "denied", data)
				return assistantActionError{validationErr}
			}
			// Reserve enough capture space for the bounded handler result before entry.
			a.mu.Lock()
			remaining := assistantTraceLimit - capture.bytes
			a.mu.Unlock()
			if remaining < 2*assistantToolResultLimit+4096 {
				return assistantActionError{errors.New("Inspection reached its memory limit before dispatch. Further work stopped.")}
			}
			if err = record("tool", "dispatched", data); err != nil {
				return err
			}
			if err = ctx.Err(); err != nil {
				return err
			}
			if err = emit(assistantEvent{Type: "tool", Name: frame.Name, Status: "running"}); err != nil {
				return err
			}
			var result string
			if frame.Name == "bind_process" {
				processID, _ := args["process_id"].(string)
				process, err = s.bindAssistantProcess(r, processID, trackedEmit)
				if err == nil {
					result = process.definitionJSON
				}
			} else if process != nil {
				result, err = s.dispatchAssistantProcessTool(r, process, frame.Name, string(frame.Arguments), trackedEmit)
			} else {
				result, err = s.dispatchAssistantTool(r, frame.Name, string(frame.Arguments))
			}
			if err != nil {
				data["error"] = err.Error()
				var saved *assistantSavedResultError
				if errors.As(err, &saved) {
					data["confirmed_save"] = saved.Result
					data["canonical_read_confirmed"] = false
				}
				status := "failed"
				if !assistantReadOnlyTool(frame.Name) {
					status = "uncertain"
				}
				_ = record("tool", status, data)
				return assistantActionError{err}
			}
			var value any
			if json.Unmarshal([]byte(result), &value) != nil {
				return errors.New("invalid_tool_result")
			}
			value = assistantSanitize(value, a.apiKey)
			data["result"] = value
			status := "completed"
			if !assistantReadOnlyTool(frame.Name) {
				status = "saved"
			}
			if err = record("tool", status, data); err != nil {
				return err
			}
			if err = ctx.Err(); err != nil {
				return err
			}
			if err = emit(assistantEvent{Type: "tool", Name: frame.Name, Status: "completed"}); err != nil {
				return err
			}
			reply := map[string]any{"type": "tool_result", "id": frame.ID, "result": value}
			if frame.Name == "bind_process" {
				reply["tools"] = assistantCatalog(process)
			}
			if err = encoder.Encode(reply); err != nil {
				return err
			}
		case "done":
			return nil
		case "error":
			return assistantActionError{errors.New("Pi stopped the interaction. Inspect the retained events and check saved work before repeating an action.")}
		default:
			return errors.New("unknown_pi_frame")
		}
	}
	if err = scanner.Err(); err != nil {
		return err
	}
	return errors.New("pi_exited_without_completion")
}
