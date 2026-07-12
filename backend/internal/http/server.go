package httpapi

import (
	"context"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/modules/kanban"
	"miraeopus/backend/internal/notifications"
	"miraeopus/backend/internal/store"
	"net/http"
	"os"
	"strings"
	"time"
)

type AuthTokenValidator interface {
	Validate(ctx context.Context, token string) (auth.Claims, error)
}

type CognitoAdminClient interface {
	AdminCreateUser(ctx context.Context, email string) (auth.CognitoAdminCreateUserResult, error)
	AdminAcceptInvitation(ctx context.Context, email, password string) (auth.CognitoAdminAcceptInvitationResult, error)
	AdminDeleteUser(ctx context.Context, username string) error
}

type AuthEmailSender interface {
	SendInvitation(ctx context.Context, input auth.InvitationEmailInput) error
	SendSignupConfirmation(ctx context.Context, email, companyName string) error
}

type BootstrapDevAdminConfig struct {
	Emails      []string
	CompanyName string
}

type Server struct {
	repo                                    store.Repository
	realtimeRegistry                        *realtimeSubscriptionRegistry
	realtimeTickets                         *realtimeTicketStore
	notifications                           *notifications.Service
	kanban                                  *kanban.Service
	workspaceDerivedCatchupCancel           context.CancelFunc
	workspaceDerivedCatchupInterval         time.Duration
	workspaceDerivedCatchupLimit            int
	notificationCleanupCancel               context.CancelFunc
	notificationCleanupInterval             time.Duration
	notificationRetentionDuration           time.Duration
	notificationCleanupLimit                int
	notificationCleanupDisabled             bool
	communicationsArchiveWorkerCancel       context.CancelFunc
	communicationsArchiveWorkerWake         chan struct{}
	communicationsArchiveWorkerInterval     time.Duration
	communicationsArchiveWorkerBatchLimit   int
	communicationsArchiveWorkerLeaseTimeout time.Duration
	communicationsArchiveWorkerDisabled     bool
	metrics                                 MetricsRecorder
	commCache                               *communicationsCache
	commArchiveMutations                    *communicationsArchiveMutationTracker
	nylasGate                               *nylasRequestGate
	nylasWebhooks                           *nylasWebhookReceiptCache
	authValidator                           AuthTokenValidator
	authCache                               *authMembershipCache
	cognitoAdmin                            CognitoAdminClient
	emailSender                             AuthEmailSender
	appBaseURL                              string
	bootstrapDevAdmin                       BootstrapDevAdminConfig
	nylasClient                             NylasClient
	nylasConfig                             NylasConfig
	attachmentStorage                       AttachmentObjectStorage
	attachmentDirectUpload                  attachmentDirectUploadConfig
	attachmentUploadCleanupCancel           context.CancelFunc
	attachmentUploadCleanupDisabled         bool
	maxBodyBytes                            int64
	legacyMapRoutesEnabled                  bool
}

type ServerOptions struct {
	DisableAttachmentUploadCleanup          bool
	AuthValidator                           AuthTokenValidator
	AuthMembershipCacheTTL                  time.Duration
	AuthMembershipCacheMaxEntries           int
	CognitoAdmin                            CognitoAdminClient
	EmailSender                             AuthEmailSender
	AppBaseURL                              string
	BootstrapDevAdmin                       BootstrapDevAdminConfig
	NylasClient                             NylasClient
	NylasConfig                             NylasConfig
	AttachmentStorage                       AttachmentObjectStorage
	RealtimeTicketSecret                    string
	MaxRequestBodyBytes                     int64
	LegacyMapRoutesEnabled                  bool
	WorkspaceDerivedCatchupInterval         time.Duration
	WorkspaceDerivedCatchupLimit            int
	NotificationCleanupInterval             time.Duration
	NotificationRetentionDuration           time.Duration
	NotificationCleanupLimit                int
	DisableNotificationCleanup              bool
	CommunicationsArchiveWorkerInterval     time.Duration
	CommunicationsArchiveWorkerBatchLimit   int
	CommunicationsArchiveWorkerLeaseTimeout time.Duration
	DisableCommunicationsArchiveWorker      bool
	Metrics                                 MetricsRecorder
}

func NewServer(repo store.Repository) *Server {
	return NewServerWithOptions(repo, ServerOptions{})
}

func normalizeBootstrapDevAdminConfig(config BootstrapDevAdminConfig) BootstrapDevAdminConfig {
	seen := make(map[string]bool, len(config.Emails))
	emails := make([]string, 0, len(config.Emails))
	for _, email := range config.Emails {
		normalized := strings.ToLower(strings.TrimSpace(email))
		if normalized == "" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		emails = append(emails, normalized)
	}
	companyName := strings.TrimSpace(config.CompanyName)
	if companyName == "" {
		companyName = "MangoRTS Bootstrap"
	}
	return BootstrapDevAdminConfig{
		Emails:      emails,
		CompanyName: companyName,
	}
}

func NewServerWithOptions(repo store.Repository, options ServerOptions) *Server {
	notificationCleanupInterval := options.NotificationCleanupInterval
	if notificationCleanupInterval <= 0 {
		notificationCleanupInterval = defaultNotificationCleanupInterval
	}
	notificationRetentionDuration := store.NormalizeNotificationRetentionDuration(options.NotificationRetentionDuration)
	notificationCleanupLimit := store.NormalizeNotificationCleanupLimit(options.NotificationCleanupLimit)
	communicationsArchiveWorkerInterval := options.CommunicationsArchiveWorkerInterval
	if communicationsArchiveWorkerInterval <= 0 {
		communicationsArchiveWorkerInterval = defaultCommunicationsArchiveWorkerInterval
	}
	communicationsArchiveWorkerBatchLimit := options.CommunicationsArchiveWorkerBatchLimit
	if communicationsArchiveWorkerBatchLimit <= 0 {
		communicationsArchiveWorkerBatchLimit = defaultCommunicationsArchiveWorkerBatchLimit
	}
	communicationsArchiveWorkerLeaseTimeout := store.NormalizeCommunicationsArchiveJobProcessingLeaseTimeout(options.CommunicationsArchiveWorkerLeaseTimeout)
	workspaceDerivedCatchupInterval := options.WorkspaceDerivedCatchupInterval
	if workspaceDerivedCatchupInterval <= 0 {
		workspaceDerivedCatchupInterval = workspaceDerivedDomainEventCatchupInterval
	}
	workspaceDerivedCatchupLimit := options.WorkspaceDerivedCatchupLimit
	if workspaceDerivedCatchupLimit <= 0 {
		workspaceDerivedCatchupLimit = workspaceDerivedDomainEventCatchupLimit
	}
	metrics := options.Metrics
	if metrics == nil {
		metrics = NewInMemoryMetricsRecorder()
	}
	realtimeTicketSecret := strings.TrimSpace(options.RealtimeTicketSecret)
	if realtimeTicketSecret == "" {
		realtimeTicketSecret = strings.TrimSpace(options.NylasConfig.StateSecret)
	}
	server := &Server{
		repo:                                    repo,
		realtimeRegistry:                        newRealtimeSubscriptionRegistry(),
		realtimeTickets:                         newRealtimeTicketStore(realtimeTicketSecret),
		notifications:                           notifications.NewService(repo),
		kanban:                                  kanban.NewService(repo),
		workspaceDerivedCatchupInterval:         workspaceDerivedCatchupInterval,
		workspaceDerivedCatchupLimit:            workspaceDerivedCatchupLimit,
		notificationCleanupInterval:             notificationCleanupInterval,
		notificationRetentionDuration:           notificationRetentionDuration,
		notificationCleanupLimit:                notificationCleanupLimit,
		notificationCleanupDisabled:             options.DisableNotificationCleanup,
		communicationsArchiveWorkerWake:         make(chan struct{}, 1),
		communicationsArchiveWorkerInterval:     communicationsArchiveWorkerInterval,
		communicationsArchiveWorkerBatchLimit:   communicationsArchiveWorkerBatchLimit,
		communicationsArchiveWorkerLeaseTimeout: communicationsArchiveWorkerLeaseTimeout,
		communicationsArchiveWorkerDisabled:     options.DisableCommunicationsArchiveWorker,
		metrics:                                 metrics,
		commCache:                               newCommunicationsCache(),
		commArchiveMutations:                    newCommunicationsArchiveMutationTracker(),
		nylasGate:                               newNylasRequestGate(communicationsNylasMinRequestInterval),
		nylasWebhooks:                           newNylasWebhookReceiptCache(),
		authValidator:                           options.AuthValidator,
		authCache:                               newAuthMembershipCache(options.AuthMembershipCacheTTL, options.AuthMembershipCacheMaxEntries),
		cognitoAdmin:                            options.CognitoAdmin,
		emailSender:                             options.EmailSender,
		appBaseURL:                              strings.TrimSpace(options.AppBaseURL),
		bootstrapDevAdmin:                       normalizeBootstrapDevAdminConfig(options.BootstrapDevAdmin),
		nylasClient:                             options.NylasClient,
		nylasConfig:                             options.NylasConfig,
		attachmentStorage:                       options.AttachmentStorage,
		attachmentDirectUpload:                  attachmentDirectUploadConfigFromEnv(),
		attachmentUploadCleanupDisabled:         options.DisableAttachmentUploadCleanup,
		maxBodyBytes:                            options.MaxRequestBodyBytes,
		legacyMapRoutesEnabled:                  options.LegacyMapRoutesEnabled || isTruthyQueryValue(os.Getenv("MANGORTS_ENABLE_LEGACY_MAP_ROUTES")),
	}
	server.initializeWorkspaceDerivedDomainEventCheckpoints(context.Background())
	server.startAttachmentUploadCleanup()
	server.startWorkspaceDerivedDomainEventCatchup()
	server.startNotificationCleanup()
	server.startCommunicationsArchiveWorker()
	return server
}

func (s *Server) Close() {
	if s.attachmentUploadCleanupCancel != nil {
		s.attachmentUploadCleanupCancel()
	}
	if s.workspaceDerivedCatchupCancel != nil {
		s.workspaceDerivedCatchupCancel()
	}
	if s.notificationCleanupCancel != nil {
		s.notificationCleanupCancel()
	}
	if s.communicationsArchiveWorkerCancel != nil {
		s.communicationsArchiveWorkerCancel()
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
	mux.HandleFunc("/v1/communications/drafts", s.handleCommunicationsEmailDrafts)
	mux.HandleFunc("/v1/communications/drafts/", s.handleCommunicationsEmailDraftByID)
	mux.HandleFunc("/v1/communications/signature", s.handleCommunicationsEmailSignature)
	mux.HandleFunc("/v1/communications/messages", s.handleCommunicationsMessages)
	mux.HandleFunc("/v1/communications/messages/archive-batch", s.handleCommunicationsMessagesArchiveBatch)
	mux.HandleFunc("/v1/communications/messages/", s.handleCommunicationsMessageByID)
	mux.HandleFunc("/v1/communications/calendar-invites/respond", s.handleCommunicationsCalendarInviteResponse)
	mux.HandleFunc("/v1/communications/threads/", s.handleCommunicationsThreadByID)
	mux.HandleFunc("/v1/communications/shared-inboxes", s.handleCommunicationsSharedInboxes)
	mux.HandleFunc("/v1/communications/shared-inboxes/", s.handleCommunicationsSharedInboxByID)
	mux.HandleFunc("/v1/communications/email-nodes/transfer", s.handleCommunicationsEmailNodeTransfer)
	mux.HandleFunc("/v1/communications/triage/convert", s.handleCommunicationsTriageConvert)
	mux.HandleFunc("/v1/communications/triage/revert-card", s.handleCommunicationsTriageRevert)
	mux.HandleFunc("/v1/communications/triage", s.handleCommunicationsTriage)
	mux.HandleFunc("/v1/communications/triage/", s.handleCommunicationsTriageByID)
	mux.HandleFunc("/v1/communications/my-logic-gates", s.handleCommunicationsMyLogicGates)
	mux.HandleFunc("/v1/communications/my-logic-gates/", s.handleCommunicationsMyLogicGateByID)
	mux.HandleFunc("/v1/notifications", s.handleNotifications)
	mux.HandleFunc("/v1/notifications/summary", s.handleNotificationSummary)
	mux.HandleFunc("/v1/notifications/unread-count", s.handleNotificationUnreadCount)
	mux.HandleFunc("/v1/notifications/read-all", s.handleNotificationReadAll)
	mux.HandleFunc("/v1/notifications/", s.handleNotificationByID)
	mux.HandleFunc("/v1/saved-views", s.handleSavedViews)
	mux.HandleFunc("/v1/saved-views/", s.handleSavedViewByID)
	mux.HandleFunc("/v1/user-pins/order", s.handleUserPinsOrder)
	mux.HandleFunc("/v1/user-pins", s.handleUserPins)
	mux.HandleFunc("/v1/user-pins/", s.handleUserPinByID)
	mux.HandleFunc("/v1/updates/groups/roots", s.handleUpdateRootGroups)
	mux.HandleFunc("/v1/updates/groups/branch", s.handleUpdateBranch)
	mux.HandleFunc("/nylas/oauth/callback", s.handleNylasOAuthCallback)
	mux.HandleFunc("/nylas/webhook", s.handleNylasWebhook)
	mux.HandleFunc("/v1/accounts", s.handleAccounts)
	mux.HandleFunc("/v1/accounts/", s.handleAccountByID)
	mux.HandleFunc("/v1/account-folders", s.handleAccountFolders)
	mux.HandleFunc("/v1/account-folders/", s.handleAccountFolderByID)
	mux.HandleFunc("/v1/attachments", s.handleAttachments)
	mux.HandleFunc("/v1/attachments/", s.handleAttachmentByID)
	mux.HandleFunc("/v1/resources/", s.handleResourceSubresource)
	mux.HandleFunc("/v1/nodes", s.handleNodes)
	mux.HandleFunc("/v1/nodes/", s.handleNodeSubresource)
	mux.HandleFunc("/v1/projects", s.handleProjects)
	mux.HandleFunc("/v1/projects/", s.handleProjectSubresource)
	mux.HandleFunc("/v1/node-relationships", s.handleNodeRelationships)
	mux.HandleFunc("/v1/node-relationships/", s.handleNodeRelationshipByID)
	mux.HandleFunc("/v1/workspace/snapshot", s.handleWorkspaceSnapshot)
	mux.HandleFunc("/v1/realtime/ticket", s.handleRealtimeTicket)
	mux.HandleFunc("/v1/realtime/ws", s.handleRealtimeWebSocket)
	mux.HandleFunc("/v1/company-explorer/roots", s.handleCompanyExplorerRoots)
	mux.HandleFunc("/v1/company-explorer/children", s.handleCompanyExplorerChildren)
	mux.HandleFunc("/v1/company-explorer/search", s.handleCompanyExplorerSearch)
	mux.HandleFunc("/v1/company-explorer/delete-targets", s.handleCompanyExplorerDeleteTargets)
	mux.HandleFunc("/v1/company-explorer/folders", s.handleCompanyExplorerFolders)
	mux.HandleFunc("/v1/company-explorer/folders/", s.handleCompanyExplorerFolderByID)
	mux.HandleFunc("/v1/company-explorer/items", s.handleCompanyExplorerItems)
	mux.HandleFunc("/v1/company-explorer/items/", s.handleCompanyExplorerItemByID)
	mux.HandleFunc("/v1/recycle-bin", s.handleRecycleBin)
	mux.HandleFunc("/v1/recycle-bin/restore", s.handleRecycleBinRestore)
	mux.HandleFunc("/v1/recycle-bin/delete", s.handleRecycleBinPermanentDelete)
	mux.HandleFunc("/v1/map-layout", s.handleMapLayout)
	mux.HandleFunc("/v1/map-entity-batches", s.handleMapEntityBatches)
	mux.HandleFunc("/v1/workspace/entity-batches", s.handleWorkspaceEntityBatches)
	mux.HandleFunc("/v1/logic-gate-arena", s.handleLogicGateArena)
	mux.HandleFunc("/v1/logic-gates", s.handleLogicGates)
	mux.HandleFunc("/v1/logic-gates/", s.handleLogicGateSubresource)
	mux.HandleFunc("/v2/gvic-matrix/nodes", s.handleGVICMatrixNodesV2)
	mux.HandleFunc("/v2/gvic-matrix/nodes/", s.handleGVICMatrixNodeByIDV2)
	mux.HandleFunc("/v1/logic-gate-relationships", s.handleLogicGateRelationships)
	mux.HandleFunc("/v1/work-items/generated-inbox", s.handleWorkItemGeneratedInbox)
	mux.HandleFunc("/v1/work-items/gvic-inbox", s.handleWorkItemACIInbox)
	mux.HandleFunc("/v1/work-items/my-nodes", s.handleWorkItemMyNodes)
	mux.HandleFunc("/v1/work-items/my-logic-gates", s.handleWorkItemMyLogicGates)
	mux.HandleFunc("/v1/work-items/my-work-matrix", s.handleWorkItemMyWorkMatrix)
	mux.HandleFunc("/v1/work-items/my-work-matrix/", s.handleWorkItemMyWorkMatrixSubresource)
	mux.HandleFunc("/v1/work-items/gvic-matrix-projection", s.handleWorkItemGVICMatrixProjection)
	mux.HandleFunc("/v1/work-items/logic-gate-assignments/move", s.handleWorkItemLogicGateAssignmentMove)
	mux.HandleFunc("/v1/work-items/logic-gate-assignments/remove", s.handleWorkItemLogicGateAssignmentRemove)
	mux.HandleFunc("/v1/work-items/logic-gate-assignments/issue", s.handleWorkItemLogicGateAssignmentIssue)
	mux.HandleFunc("/v1/work-items/logic-gate-assignments", s.handleWorkItemLogicGateAssignments)
	mux.HandleFunc("/v1/project-management/timeline", s.handleProjectManagementTimelineProjection)
	mux.HandleFunc("/v1/project-management/timeline-items", s.handleProjectManagementTimelineItems)
	mux.HandleFunc("/v1/project-management/timeline-items/", s.handleProjectManagementTimelineItemByID)
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
	payload["email_sender_configured"] = strings.TrimSpace(os.Getenv("MANGORTS_EMAIL_FROM")) != ""
	payload["aws_env_credentials_configured"] = strings.TrimSpace(os.Getenv("AWS_ACCESS_KEY_ID")) != "" && strings.TrimSpace(os.Getenv("AWS_SECRET_ACCESS_KEY")) != ""
	writeJSON(w, http.StatusOK, payload)
}

func addHealthEnv(payload map[string]any, field, envKey string) {
	if value := os.Getenv(envKey); value != "" {
		payload[field] = value
	}
}
