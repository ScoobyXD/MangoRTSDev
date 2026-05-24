package httpapi

import (
	"context"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/modules/kanban"
	"miraeopus/backend/internal/notifications"
	"miraeopus/backend/internal/store"
	"net/http"
	"os"
	"time"
)

type AuthTokenValidator interface {
	Validate(ctx context.Context, token string) (auth.Claims, error)
}

type CognitoAdminClient interface {
	AdminCreateUser(ctx context.Context, email string) error
	AdminDeleteUser(ctx context.Context, username string) error
}

type AuthEmailSender interface {
	SendSignupConfirmation(ctx context.Context, email, companyName string) error
}

type Server struct {
	repo                        store.Repository
	hub                         *workspaceEventHub
	emailHub                    *workspaceEventHub
	notificationHub             *workspaceEventHub
	notifications               *notifications.Service
	kanban                      *kanban.Service
	workspaceWakeHub            *workspaceEventNotificationHub
	workspaceFanout             store.WorkspaceEventFanout
	workspaceFanoutCancel       context.CancelFunc
	workspaceCatchupInterval    time.Duration
	notificationCatchupCancel   context.CancelFunc
	notificationCatchupInterval time.Duration
	notificationCatchupLimit    int
	metrics                     MetricsRecorder
	commCache                   *communicationsCache
	nylasGate                   *nylasRequestGate
	nylasWebhooks               *nylasWebhookReceiptCache
	authValidator               AuthTokenValidator
	authCache                   *authMembershipCache
	cognitoAdmin                CognitoAdminClient
	emailSender                 AuthEmailSender
	nylasClient                 NylasClient
	nylasConfig                 NylasConfig
	maxBodyBytes                int64
	legacyMapRoutesEnabled      bool
	legacyKanbanRoutesEnabled   bool
}

type ServerOptions struct {
	AuthValidator                 AuthTokenValidator
	AuthMembershipCacheTTL        time.Duration
	AuthMembershipCacheMaxEntries int
	CognitoAdmin                  CognitoAdminClient
	EmailSender                   AuthEmailSender
	NylasClient                   NylasClient
	NylasConfig                   NylasConfig
	MaxRequestBodyBytes           int64
	LegacyMapRoutesEnabled        bool
	LegacyKanbanRoutesEnabled     bool
	WorkspaceEventFanout          store.WorkspaceEventFanout
	WorkspaceCatchupInterval      time.Duration
	NotificationCatchupInterval   time.Duration
	NotificationCatchupLimit      int
	Metrics                       MetricsRecorder
}

func NewServer(repo store.Repository) *Server {
	return NewServerWithOptions(repo, ServerOptions{})
}

func NewServerWithOptions(repo store.Repository, options ServerOptions) *Server {
	catchupInterval := options.WorkspaceCatchupInterval
	if catchupInterval <= 0 {
		catchupInterval = workspaceCatchupInterval
	}
	notificationCatchupInterval := options.NotificationCatchupInterval
	if notificationCatchupInterval <= 0 {
		notificationCatchupInterval = notificationDomainEventCatchupInterval
	}
	notificationCatchupLimit := options.NotificationCatchupLimit
	if notificationCatchupLimit <= 0 {
		notificationCatchupLimit = notificationDomainEventCatchupLimit
	}
	metrics := options.Metrics
	if metrics == nil {
		metrics = NewInMemoryMetricsRecorder()
	}
	server := &Server{
		repo:                        repo,
		hub:                         newWorkspaceEventHub(),
		emailHub:                    newWorkspaceEventHub(),
		notificationHub:             newWorkspaceEventHub(),
		notifications:               notifications.NewService(repo),
		kanban:                      kanban.NewService(repo),
		workspaceWakeHub:            newWorkspaceEventNotificationHub(),
		workspaceFanout:             options.WorkspaceEventFanout,
		workspaceCatchupInterval:    catchupInterval,
		notificationCatchupInterval: notificationCatchupInterval,
		notificationCatchupLimit:    notificationCatchupLimit,
		metrics:                     metrics,
		commCache:                   newCommunicationsCache(),
		nylasGate:                   newNylasRequestGate(communicationsNylasMinRequestInterval),
		nylasWebhooks:               newNylasWebhookReceiptCache(),
		authValidator:               options.AuthValidator,
		authCache:                   newAuthMembershipCache(options.AuthMembershipCacheTTL, options.AuthMembershipCacheMaxEntries),
		cognitoAdmin:                options.CognitoAdmin,
		emailSender:                 options.EmailSender,
		nylasClient:                 options.NylasClient,
		nylasConfig:                 options.NylasConfig,
		maxBodyBytes:                options.MaxRequestBodyBytes,
		legacyMapRoutesEnabled:      options.LegacyMapRoutesEnabled || isTruthyQueryValue(os.Getenv("MANGORTS_ENABLE_LEGACY_MAP_ROUTES")),
		legacyKanbanRoutesEnabled:   options.LegacyKanbanRoutesEnabled || isTruthyQueryValue(os.Getenv("MANGORTS_ENABLE_LEGACY_KANBAN_ROUTES")),
	}
	server.initializeNotificationDomainEventCheckpoints(context.Background())
	server.startWorkspaceEventFanout()
	server.startNotificationDomainEventCatchup()
	return server
}

func (s *Server) Close() {
	if s.workspaceFanoutCancel != nil {
		s.workspaceFanoutCancel()
	}
	if s.notificationCatchupCancel != nil {
		s.notificationCatchupCancel()
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/v2/nodes/", s.handleNodeViewV2Subresource)
	mux.HandleFunc("/v2/logic-gates/", s.handleLogicGateWorkV2Subresource)
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
	mux.HandleFunc("/v1/communications/shared-inboxes", s.handleCommunicationsSharedInboxes)
	mux.HandleFunc("/v1/communications/shared-inboxes/", s.handleCommunicationsSharedInboxByID)
	mux.HandleFunc("/v1/communications/triage/convert", s.handleCommunicationsTriageConvert)
	mux.HandleFunc("/v1/communications/triage/revert-card", s.handleCommunicationsTriageRevert)
	mux.HandleFunc("/v1/communications/triage", s.handleCommunicationsTriage)
	mux.HandleFunc("/v1/communications/triage/", s.handleCommunicationsTriageByID)
	mux.HandleFunc("/v1/communications/my-logic-gates", s.handleCommunicationsMyLogicGates)
	mux.HandleFunc("/v1/communications/my-logic-gates/", s.handleCommunicationsMyLogicGateByID)
	mux.HandleFunc("/v1/communications/stream", s.handleCommunicationsStream)
	mux.HandleFunc("/v1/notifications", s.handleNotifications)
	mux.HandleFunc("/v1/notifications/summary", s.handleNotificationSummary)
	mux.HandleFunc("/v1/notifications/unread-count", s.handleNotificationUnreadCount)
	mux.HandleFunc("/v1/notifications/read-all", s.handleNotificationReadAll)
	mux.HandleFunc("/v1/notifications/stream", s.handleNotificationStream)
	mux.HandleFunc("/v1/notifications/", s.handleNotificationByID)
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
	mux.HandleFunc("/v1/workspace/entity-batches", s.handleWorkspaceEntityBatches)
	mux.HandleFunc("/v1/logic-gate-arena", s.handleLogicGateArena)
	mux.HandleFunc("/v1/logic-gates", s.handleLogicGates)
	mux.HandleFunc("/v1/logic-gates/", s.handleLogicGateSubresource)
	mux.HandleFunc("/v1/logic-gate-relationships", s.handleLogicGateRelationships)
	mux.HandleFunc("/v1/work-items/responsible-inbox", s.handleWorkItemResponsibleInbox)
	mux.HandleFunc("/v1/work-items/aci-inbox", s.handleWorkItemACIInbox)
	mux.HandleFunc("/v1/work-items/my-nodes", s.handleWorkItemMyNodes)
	mux.HandleFunc("/v1/work-items/my-logic-gates", s.handleWorkItemMyLogicGates)
	mux.HandleFunc("/v1/work-items/logic-gate-assignments/move", s.handleWorkItemLogicGateAssignmentMove)
	mux.HandleFunc("/v1/work-items/logic-gate-assignments/remove", s.handleWorkItemLogicGateAssignmentRemove)
	mux.HandleFunc("/v1/work-items/logic-gate-assignments/issue", s.handleWorkItemLogicGateAssignmentIssue)
	mux.HandleFunc("/v1/work-items/logic-gate-assignments", s.handleWorkItemLogicGateAssignments)
	mux.HandleFunc("/v1/logic-gate-relationships/", s.handleLogicGateRelationshipByID)
	mux.HandleFunc("/v1/kanban/boards", s.handleKanbanBoards)
	mux.HandleFunc("/v1/kanban/boards/", s.handleKanbanBoardByID)
	mux.HandleFunc("/v1/kanban/columns", s.handleKanbanColumns)
	mux.HandleFunc("/v1/kanban/columns/", s.handleKanbanColumnByID)
	mux.HandleFunc("/v1/kanban/cards", s.handleKanbanCards)
	mux.HandleFunc("/v1/kanban/cards/", s.handleKanbanCardByID)
	return s.withHTTPMetrics(s.withRequestLimits(s.withAuth(mux)))
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
