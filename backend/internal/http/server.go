package httpapi

import (
	"context"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/store"
	"net/http"
	"os"
)

type CognitoAdminClient interface {
	AdminCreateUser(ctx context.Context, email string) error
	AdminDeleteUser(ctx context.Context, username string) error
}

type AuthEmailSender interface {
	SendSignupConfirmation(ctx context.Context, email, companyName string) error
}

type Server struct {
	repo          store.Repository
	hub           *workspaceEventHub
	emailHub      *workspaceEventHub
	commCache     *communicationsCache
	authValidator *auth.Validator
	cognitoAdmin  CognitoAdminClient
	emailSender   AuthEmailSender
	nylasClient   NylasClient
	nylasConfig   NylasConfig
	maxBodyBytes  int64
}

type ServerOptions struct {
	AuthValidator       *auth.Validator
	CognitoAdmin        CognitoAdminClient
	EmailSender         AuthEmailSender
	NylasClient         NylasClient
	NylasConfig         NylasConfig
	MaxRequestBodyBytes int64
}

func NewServer(repo store.Repository) *Server {
	return NewServerWithOptions(repo, ServerOptions{})
}

func NewServerWithOptions(repo store.Repository, options ServerOptions) *Server {
	return &Server{
		repo:          repo,
		hub:           newWorkspaceEventHub(),
		emailHub:      newWorkspaceEventHub(),
		commCache:     newCommunicationsCache(),
		authValidator: options.AuthValidator,
		cognitoAdmin:  options.CognitoAdmin,
		emailSender:   options.EmailSender,
		nylasClient:   options.NylasClient,
		nylasConfig:   options.NylasConfig,
		maxBodyBytes:  options.MaxRequestBodyBytes,
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/v1/me", s.handleMe)
	mux.HandleFunc("/v1/companies", s.handleCompanies)
	mux.HandleFunc("/v1/companies/", s.handleCompanySubresource)
	mux.HandleFunc("/v1/invitations", s.handleInvitations)
	mux.HandleFunc("/v1/invitations/validate", s.handleInvitationValidate)
	mux.HandleFunc("/v1/invitations/accept", s.handleInvitationAccept)
	mux.HandleFunc("/v1/password-resets/request", s.handlePasswordResetRequest)
	mux.HandleFunc("/v1/communications/status", s.handleCommunicationsStatus)
	mux.HandleFunc("/v1/communications/auth-url", s.handleCommunicationsAuthURL)
	mux.HandleFunc("/v1/communications/disconnect", s.handleCommunicationsDisconnect)
	mux.HandleFunc("/v1/communications/folders", s.handleCommunicationsFolders)
	mux.HandleFunc("/v1/communications/messages", s.handleCommunicationsMessages)
	mux.HandleFunc("/v1/communications/messages/", s.handleCommunicationsMessageByID)
	mux.HandleFunc("/v1/communications/stream", s.handleCommunicationsStream)
	mux.HandleFunc("/nylas/oauth/callback", s.handleNylasOAuthCallback)
	mux.HandleFunc("/nylas/webhook", s.handleNylasWebhook)
	mux.HandleFunc("/v1/nodes", s.handleNodes)
	mux.HandleFunc("/v1/nodes/", s.handleNodeSubresource)
	mux.HandleFunc("/v1/node-relationships", s.handleNodeRelationships)
	mux.HandleFunc("/v1/node-relationships/", s.handleNodeRelationshipByID)
	mux.HandleFunc("/v1/workspace/snapshot", s.handleWorkspaceSnapshot)
	mux.HandleFunc("/v1/workspace/stream", s.handleWorkspaceStream)
	mux.HandleFunc("/v1/editor/collaboration/events", s.handleEditorCollaborationEvents)
	mux.HandleFunc("/v1/company-explorer/folders", s.handleCompanyExplorerFolders)
	mux.HandleFunc("/v1/company-explorer/folders/", s.handleCompanyExplorerFolderByID)
	mux.HandleFunc("/v1/company-explorer/delete-batch", s.handleCompanyExplorerDeleteBatch)
	mux.HandleFunc("/v1/company-explorer/folder-items/batch", s.handleCompanyExplorerFolderItemsBatch)
	mux.HandleFunc("/v1/company-explorer/folder-items", s.handleCompanyExplorerFolderItems)
	mux.HandleFunc("/v1/map-layout", s.handleMapLayout)
	mux.HandleFunc("/v1/map-entity-batches", s.handleMapEntityBatches)
	mux.HandleFunc("/v1/logic-gate-arena", s.handleLogicGateArena)
	mux.HandleFunc("/v1/logic-gates", s.handleLogicGates)
	mux.HandleFunc("/v1/logic-gates/", s.handleLogicGateSubresource)
	mux.HandleFunc("/v1/logic-gate-relationships", s.handleLogicGateRelationships)
	mux.HandleFunc("/v1/logic-gate-relationships/", s.handleLogicGateRelationshipByID)
	mux.HandleFunc("/v1/kanban/boards", s.handleKanbanBoards)
	mux.HandleFunc("/v1/kanban/boards/", s.handleKanbanBoardByID)
	mux.HandleFunc("/v1/kanban/columns", s.handleKanbanColumns)
	mux.HandleFunc("/v1/kanban/columns/", s.handleKanbanColumnByID)
	mux.HandleFunc("/v1/kanban/cards", s.handleKanbanCards)
	mux.HandleFunc("/v1/kanban/cards/", s.handleKanbanCardByID)
	return s.withRequestLimits(s.withAuth(mux))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	payload := map[string]any{"ok": true}
	addHealthEnv(payload, "app_env", "APP_ENV")
	addHealthEnv(payload, "auth_mode", "AUTH_MODE")
	addHealthEnv(payload, "allowed_origin", "MANGORTS_ALLOWED_ORIGIN")
	addHealthEnv(payload, "deploy_environment", "MANGORTS_DEPLOY_ENV")
	addHealthEnv(payload, "deploy_revision", "MANGORTS_DEPLOY_REVISION")
	addHealthEnv(payload, "app_url", "MANGORTS_APP_URL")
	addHealthEnv(payload, "api_url", "MANGORTS_API_URL")
	writeJSON(w, http.StatusOK, payload)
}

func addHealthEnv(payload map[string]any, field, envKey string) {
	if value := os.Getenv(envKey); value != "" {
		payload[field] = value
	}
}
