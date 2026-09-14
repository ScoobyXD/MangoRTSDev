package httpapi

import (
	"context"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/ctrlloopexcel"
	"miraeopus/backend/internal/emailqueue"
	"miraeopus/backend/internal/notifications"
	"miraeopus/backend/internal/openaiagents"
	"miraeopus/backend/internal/realtime"
	"miraeopus/backend/internal/store"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sync/singleflight"
)

type AuthTokenValidator interface {
	Validate(ctx context.Context, token string) (auth.Claims, error)
}

type CognitoAdminClient interface {
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
	repo                                   store.Repository
	realtimeRegistry                       *realtimeSubscriptionRegistry
	realtimeTickets                        *realtimeTicketStore
	realtimeBackplane                      realtime.Backplane
	realtimeSpineContext                   context.Context
	realtimeSpineCancel                    context.CancelFunc
	realtimeSpineWake                      chan struct{}
	realtimeSpineRecovery                  chan struct{}
	realtimeSpineInbound                   chan []byte
	realtimeSpineSafetyInterval            time.Duration
	realtimeSpineStorageTimeout            time.Duration
	realtimeSpineClaimLease                time.Duration
	realtimeSpineDisabled                  bool
	realtimeSpineReady                     atomic.Bool
	realtimeSpineMu                        sync.Mutex
	realtimeSpinePublishMu                 sync.Mutex
	realtimeSpinePublishRetryAttempts      int
	realtimeSpinePublishRetryAt            time.Time
	realtimeSpinePublishRetryTimer         *time.Timer
	realtimeSpinePublishRetryGeneration    uint64
	realtimeSpinePublishLeaseRetryPending  bool
	realtimeSpineCursor                    int64
	realtimeSpinePending                   map[int64]store.RealtimeOutboxEvent
	realtimeSpineDedupe                    *realtimeEventDeduper
	realtimeSpineInitialBackplaneReady     chan struct{}
	realtimeSpineInitialBackplaneReadyOnce sync.Once
	realtimeSpineRetrySequence             int64
	realtimeSpineRetryAttempts             int
	realtimeSpineRetryAt                   time.Time
	realtimeSpineRetryTimer                *time.Timer
	realtimeSpineRetryGeneration           uint64
	realtimeSpineRecoveryRetryAttempts     int
	realtimeSpineRecoveryRetryAt           time.Time
	realtimeSpineRecoveryRetryTimer        *time.Timer
	realtimeSpineRecoveryRetryGeneration   uint64
	notifications                          *notifications.Service
	notificationCleanupCancel              context.CancelFunc
	notificationCleanupInterval            time.Duration
	notificationRetentionDuration          time.Duration
	notificationCleanupLimit               int
	notificationCleanupDisabled            bool
	metrics                                MetricsRecorder
	commCache                              *communicationsCache
	communicationsFolderFlights            singleflight.Group
	communicationsMessageFlights           singleflight.Group
	communicationsMessagePageFlights       singleflight.Group
	nylasGate                              *nylasRequestGate
	nylasWebhooks                          *nylasWebhookReceiptCache
	authValidator                          AuthTokenValidator
	testAuthHeaderEnabled                  bool
	authCache                              *authMembershipCache
	authFlights                            singleflight.Group
	authMembershipFlights                  singleflight.Group
	authResolutionTimeout                  time.Duration
	cognitoAdmin                           CognitoAdminClient
	emailSender                            AuthEmailSender
	emailQueue                             emailqueue.Sender
	emailWorkerExternalRealtime            bool
	appBaseURL                             string
	bootstrapDevAdmin                      BootstrapDevAdminConfig
	nylasClient                            NylasClient
	nylasConfig                            NylasConfig
	deepgramAPIKey                         string
	aiClient                               *openaiagents.Client
	ctrlLoopMCPURL                         string
	ctrlLoopModel                          string
	aiAPIKey                               string
	aiLiveClient                           *http.Client
	aiLiveURL                              string
	transcriptionClient                    *http.Client
	attachmentStorage                      AttachmentObjectStorage
	attachmentVariantEnsurer               AttachmentImageVariantEnsurer
	attachmentRemoteImageDownloader        attachmentRemoteImageDownloader
	attachmentDirectUpload                 attachmentDirectUploadConfig
	attachmentUploadCleanupCancel          context.CancelFunc
	attachmentUploadCleanupDisabled        bool
	attachmentDeletionCleanupCancel        context.CancelFunc
	attachmentDeletionCleanupWake          chan struct{}
	maxBodyBytes                           int64
}

type ServerOptions struct {
	DisableAttachmentUploadCleanup bool
	AuthValidator                  AuthTokenValidator
	TestAuthHeaderEnabled          bool
	AuthMembershipCacheTTL         time.Duration
	AuthMembershipCacheMaxEntries  int
	AuthResolutionTimeout          time.Duration
	CognitoAdmin                   CognitoAdminClient
	EmailSender                    AuthEmailSender
	EmailQueue                     emailqueue.Sender
	EmailWorkerOnly                bool
	EmailWorkerExternalRealtime    bool
	AppBaseURL                     string
	BootstrapDevAdmin              BootstrapDevAdminConfig
	NylasClient                    NylasClient
	NylasConfig                    NylasConfig
	DeepgramAPIKey                 string
	OpenAIAPIKey                   string
	AttachmentStorage              AttachmentObjectStorage
	AttachmentVariantEnsurer       AttachmentImageVariantEnsurer
	RealtimeTicketSecret           string
	RealtimeBackplane              realtime.Backplane
	RealtimeSpineSafetyInterval    time.Duration
	RealtimeSpineStorageTimeout    time.Duration
	RealtimeSpineClaimLease        time.Duration
	DisableRealtimeSpine           bool
	MaxRequestBodyBytes            int64
	NotificationCleanupInterval    time.Duration
	NotificationRetentionDuration  time.Duration
	NotificationCleanupLimit       int
	DisableNotificationCleanup     bool
	Metrics                        MetricsRecorder
}

func NewServer(repo store.Repository) *Server {
	return NewServerWithOptions(repo, ServerOptions{RealtimeBackplane: realtime.NewLocalBackplane()})
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
	// This deliberate top-level lifecycle exists even when the worker is disabled,
	// so every synchronous realtime repository call still has a real cancelable
	// server context instead of creating its own background context.
	realtimeSpineContext, realtimeSpineCancel := context.WithCancel(context.Background())
	notificationCleanupInterval := options.NotificationCleanupInterval
	if notificationCleanupInterval <= 0 {
		notificationCleanupInterval = defaultNotificationCleanupInterval
	}
	notificationRetentionDuration := store.NormalizeNotificationRetentionDuration(options.NotificationRetentionDuration)
	notificationCleanupLimit := store.NormalizeNotificationCleanupLimit(options.NotificationCleanupLimit)
	metrics := options.Metrics
	if metrics == nil {
		metrics = NewInMemoryMetricsRecorder()
	}
	authResolutionTimeout := options.AuthResolutionTimeout
	if authResolutionTimeout <= 0 {
		authResolutionTimeout = defaultAuthResolutionTimeout
	}
	realtimeTicketSecret := strings.TrimSpace(options.RealtimeTicketSecret)
	if realtimeTicketSecret == "" {
		realtimeTicketSecret = strings.TrimSpace(options.NylasConfig.StateSecret)
	}
	server := &Server{
		aiAPIKey:                           strings.TrimSpace(options.OpenAIAPIKey),
		ctrlLoopMCPURL:                     strings.TrimSpace(os.Getenv("MANGORTS_CTRL_LOOP_MCP_URL")),
		ctrlLoopModel:                      firstNonBlank(os.Getenv("MANGORTS_CTRL_LOOP_MODEL"), "gpt-5.6-luna"),
		aiLiveClient:                       newAILiveClient(),
		aiLiveURL:                          "https://api.openai.com/v1/live/sessions",
		repo:                               repo,
		realtimeRegistry:                   newRealtimeSubscriptionRegistry(),
		realtimeTickets:                    newRealtimeTicketStore(realtimeTicketSecret),
		realtimeBackplane:                  options.RealtimeBackplane,
		realtimeSpineContext:               realtimeSpineContext,
		realtimeSpineCancel:                realtimeSpineCancel,
		realtimeSpineWake:                  make(chan struct{}, 1),
		realtimeSpineRecovery:              make(chan struct{}, 1),
		realtimeSpineInbound:               make(chan []byte, 512),
		realtimeSpineSafetyInterval:        options.RealtimeSpineSafetyInterval,
		realtimeSpineStorageTimeout:        options.RealtimeSpineStorageTimeout,
		realtimeSpineClaimLease:            options.RealtimeSpineClaimLease,
		realtimeSpineDisabled:              options.DisableRealtimeSpine,
		realtimeSpinePending:               map[int64]store.RealtimeOutboxEvent{},
		realtimeSpineDedupe:                newRealtimeEventDeduper(4096),
		realtimeSpineInitialBackplaneReady: make(chan struct{}),
		notifications:                      notifications.NewService(repo),
		notificationCleanupInterval:        notificationCleanupInterval,
		notificationRetentionDuration:      notificationRetentionDuration,
		notificationCleanupLimit:           notificationCleanupLimit,
		notificationCleanupDisabled:        options.DisableNotificationCleanup,
		metrics:                            metrics,
		commCache:                          newCommunicationsCache(),
		nylasGate:                          newNylasRequestGate(communicationsNylasMinRequestInterval),
		nylasWebhooks:                      newNylasWebhookReceiptCache(),
		authValidator:                      options.AuthValidator,
		testAuthHeaderEnabled:              options.TestAuthHeaderEnabled,
		authCache:                          newAuthMembershipCache(options.AuthMembershipCacheTTL, options.AuthMembershipCacheMaxEntries),
		authResolutionTimeout:              authResolutionTimeout,
		cognitoAdmin:                       options.CognitoAdmin,
		emailSender:                        options.EmailSender,
		emailQueue:                         options.EmailQueue,
		emailWorkerExternalRealtime:        options.EmailWorkerExternalRealtime,
		appBaseURL:                         strings.TrimSpace(options.AppBaseURL),
		bootstrapDevAdmin:                  normalizeBootstrapDevAdminConfig(options.BootstrapDevAdmin),
		nylasClient:                        options.NylasClient,
		nylasConfig:                        options.NylasConfig,
		attachmentStorage:                  options.AttachmentStorage,
		attachmentVariantEnsurer:           options.AttachmentVariantEnsurer,
		attachmentRemoteImageDownloader:    newSafeAttachmentRemoteImageDownloader(),
		attachmentDirectUpload:             attachmentDirectUploadConfigFromEnv(),
		attachmentUploadCleanupDisabled:    options.DisableAttachmentUploadCleanup,
		attachmentDeletionCleanupWake:      make(chan struct{}, 1),
		maxBodyBytes:                       options.MaxRequestBodyBytes,
		deepgramAPIKey:                     strings.TrimSpace(options.DeepgramAPIKey),
		transcriptionClient:                newTranscriptionClient(),
	}
	if server.attachmentVariantEnsurer == nil && server.attachmentStorage != nil {
		server.attachmentVariantEnsurer = repositoryAttachmentImageVariantEnsurer{repo: repo, storage: server.attachmentStorage}
	}
	if !options.EmailWorkerOnly {
		server.startAttachmentUploadCleanup()
		server.startNotificationCleanup()
	}
	server.startAttachmentDeletionCleanup()
	server.startRealtimeSpine()
	if server.aiAPIKey != "" {
		server.aiClient = openaiagents.NewClient(server.aiAPIKey, nil, "")
	}
	return server
}

func (s *Server) Close() {
	if s != nil {
		s.realtimeSpineReady.Store(false)
	}
	if s != nil && s.realtimeSpineCancel != nil {
		s.realtimeSpineCancel()
	}
	if s != nil {
		s.realtimeSpineMu.Lock()
		s.clearRealtimeSpineRetryLocked()
		s.clearRealtimeRecoveryRetryLocked()
		s.realtimeSpineMu.Unlock()
		s.realtimeSpinePublishMu.Lock()
		s.clearRealtimePublishRetryLocked()
		s.realtimeSpinePublishMu.Unlock()
	}
	if s.realtimeBackplane != nil {
		s.realtimeBackplane.Close()
	}
	if s.attachmentUploadCleanupCancel != nil {
		s.attachmentUploadCleanupCancel()
	}
	if s.attachmentDeletionCleanupCancel != nil {
		s.attachmentDeletionCleanupCancel()
	}
	if s.notificationCleanupCancel != nil {
		s.notificationCleanupCancel()
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/ctrl-loop/jobs", s.handleCtrlLoopJobs)
	mux.HandleFunc("/v1/ctrl-loop/jobs/", s.handleCtrlLoopJob)
	mux.HandleFunc("/v1/ctrl-loop/emails/", s.handleCtrlLoopSourceEmail)
	mux.Handle("/v1/ctrl-loop/mcp", ctrlloopexcel.NewHandler(ctrlLoopExcelBackend{s: s}))
	mux.HandleFunc("/v1/ai/sessions", s.handleAISessions)
	mux.HandleFunc("/v1/ai/sessions/", s.handleAISession)
	mux.HandleFunc("/v1/ai/live", s.handleAILive)
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/v2/nodes/", s.handleNodeViewV2Subresource)
	mux.HandleFunc("/v2/logic-gates/", s.handleLogicGateWorkV2Subresource)
	mux.HandleFunc("/v1/me", s.handleMe)
	mux.HandleFunc("/v1/transcriptions", s.handleTranscription)
	mux.HandleFunc("/v1/companies", s.handleCompanies)
	mux.HandleFunc("/v1/companies/", s.handleCompanySubresource)
	mux.HandleFunc("/v1/invitations", s.handleInvitations)
	mux.HandleFunc("/v1/invitations/validate", s.handleInvitationValidate)
	mux.HandleFunc("/v1/invitations/accept", s.handleInvitationAccept)
	mux.HandleFunc("/v1/communications/status", s.handleCommunicationsStatus)
	mux.HandleFunc("/v1/communications/auth-url", s.handleCommunicationsAuthURL)
	mux.HandleFunc("/v1/communications/disconnect", s.handleCommunicationsDisconnect)
	mux.HandleFunc("/v1/communications/folders", s.handleCommunicationsFolders)
	mux.HandleFunc("/v1/communications/drafts", s.handleCommunicationsEmailDrafts)
	mux.HandleFunc("/v1/communications/drafts/", s.handleCommunicationsEmailDraftByID)
	mux.HandleFunc("/v1/communications/email-collaborations", s.handleCommunicationsEmailCollaborations)
	mux.HandleFunc("/v1/communications/email-collaborations/", s.handleCommunicationsEmailCollaborationByID)
	mux.HandleFunc("/v1/communications/email-thread-chats", s.handleCommunicationsEmailThreadChats)
	mux.HandleFunc("/v1/communications/signature", s.handleCommunicationsEmailSignature)
	mux.HandleFunc("/v1/communications/stored-messages", s.handleCommunicationsStoredMessages)
	mux.HandleFunc("/v1/communications/messages", s.handleCommunicationsMessages)
	mux.HandleFunc("/v1/communications/messages/archive-batch", s.handleCommunicationsMessagesArchiveBatch)
	mux.HandleFunc("/v1/communications/archive-jobs/", s.handleCommunicationsArchiveJobByID)
	mux.HandleFunc("/v1/communications/messages/", s.handleCommunicationsMessageByID)
	mux.HandleFunc("/v1/communications/calendar-invites/respond", s.handleCommunicationsCalendarInviteResponse)
	mux.HandleFunc("/v1/communications/calendar-invites/event", s.handleCommunicationsCalendarInviteEvent)
	mux.HandleFunc("/v1/communications/threads/", s.handleCommunicationsThreadByID)
	mux.HandleFunc("/v1/communications/shared-inboxes", s.handleCommunicationsSharedInboxes)
	mux.HandleFunc("/v1/communications/shared-inboxes/", s.handleCommunicationsSharedInboxByID)
	mux.HandleFunc("/v1/communications/email-nodes/transfer", s.handleCommunicationsEmailNodeTransfer)
	mux.HandleFunc("/v1/communications/triage/convert", s.handleCommunicationsTriageConvert)
	mux.HandleFunc("/v1/communications/triage/revert-card", s.handleCommunicationsTriageRevert)
	mux.HandleFunc("/v1/notifications", s.handleNotifications)
	mux.HandleFunc("/v1/notifications/summary", s.handleNotificationSummary)
	mux.HandleFunc("/v1/notifications/unread-count", s.handleNotificationUnreadCount)
	mux.HandleFunc("/v1/notifications/read-all", s.handleNotificationReadAll)
	mux.HandleFunc("/v1/notifications/", s.handleNotificationByID)
	mux.HandleFunc("/v1/saved-views", s.handleSavedViews)
	mux.HandleFunc("/v1/saved-views/", s.handleSavedViewByID)
	mux.HandleFunc("/v1/user-pins/layout", s.handleUserPinsLayout)
	mux.HandleFunc("/v1/user-pins", s.handleUserPins)
	mux.HandleFunc("/v1/user-pins/", s.handleUserPinByID)
	mux.HandleFunc("/v1/user-pin-folders/group", s.handleUserPinFolderGroup)
	mux.HandleFunc("/v1/user-pin-folders", s.handleUserPinFolders)
	mux.HandleFunc("/v1/user-pin-folders/", s.handleUserPinFolderByID)
	mux.HandleFunc("/v1/updates/groups/roots", s.handleUpdateRootGroups)
	mux.HandleFunc("/v1/updates/groups/branch", s.handleUpdateBranch)
	mux.HandleFunc("/v1/updates/seen-range", s.handleSeenUpdatesRange)
	mux.HandleFunc("/nylas/oauth/callback", s.handleNylasOAuthCallback)
	mux.HandleFunc("/nylas/webhook", s.handleNylasWebhook)
	mux.HandleFunc("/v1/accounts", s.handleAccounts)
	mux.HandleFunc("/v1/accounts/", s.handleAccountByID)
	mux.HandleFunc("/v1/account-folders", s.handleAccountFolders)
	mux.HandleFunc("/v1/account-folders/", s.handleAccountFolderByID)
	mux.HandleFunc("/v1/entity-types", s.handleEntityTypes)
	mux.HandleFunc("/v1/entity-types/", s.handleEntityTypeByID)
	mux.HandleFunc("/v1/entity-folders", s.handleEntityFolders)
	mux.HandleFunc("/v1/entity-folders/", s.handleEntityFolderByID)
	mux.HandleFunc("/v1/entity-field-types", s.handleEntityFieldTypes)
	mux.HandleFunc("/v1/entity-field-types/", s.handleEntityFieldTypeByID)
	mux.HandleFunc("/v1/entities", s.handleEntities)
	mux.HandleFunc("/v1/entities/", s.handleEntityByID)
	mux.HandleFunc("/v1/action-items", s.handleActionItems)
	mux.HandleFunc("/v1/action-items/", s.handleActionItemSource)
	mux.HandleFunc("/v1/my-work", s.handleMyWork)
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
	mux.HandleFunc("/v1/editor-data-format", s.handleEditorDataFormat)
	mux.HandleFunc("/v1/editor-json/", s.handleEditorJSON)
	mux.HandleFunc("/v1/company-explorer/roots", s.handleCompanyExplorerRoots)
	mux.HandleFunc("/v1/company-explorer/children", s.handleCompanyExplorerChildren)
	mux.HandleFunc("/v1/company-explorer/search", s.handleCompanyExplorerSearch)
	mux.HandleFunc("/v1/company-explorer/location-path", s.handleCompanyExplorerLocationPath)
	mux.HandleFunc("/v1/company-explorer/delete-targets", s.handleCompanyExplorerDeleteTargets)
	mux.HandleFunc("/v1/company-explorer/folders", s.handleCompanyExplorerFolders)
	mux.HandleFunc("/v1/company-explorer/folders/", s.handleCompanyExplorerFolderByID)
	mux.HandleFunc("/v1/company-explorer/items", s.handleCompanyExplorerItems)
	mux.HandleFunc("/v1/company-explorer/items/", s.handleCompanyExplorerItemByID)
	mux.HandleFunc("/v1/recycle-bin", s.handleRecycleBin)
	mux.HandleFunc("/v1/recycle-bin/restore", s.handleRecycleBinRestore)
	mux.HandleFunc("/v1/recycle-bin/delete", s.handleRecycleBinPermanentDelete)
	mux.HandleFunc("/v1/workspace/entity-batches", s.handleWorkspaceEntityBatches)
	mux.HandleFunc("/v1/logic-gates", s.handleLogicGates)
	mux.HandleFunc("/v1/logic-gates/", s.handleLogicGateSubresource)
	mux.HandleFunc("/v1/process-map/scene", s.handleProcessMapScene)
	mux.HandleFunc("/v1/process-map/changes", s.handleProcessMapChanges)
	mux.HandleFunc("/v1/process-map/tiles/", s.handleProcessMapTile)
	mux.HandleFunc("/v1/process-map/placements/", s.handleProcessMapPlacement)
	mux.HandleFunc("/v1/process-map/operational-relationships", s.handleProcessMapOperationalRelationships)
	mux.HandleFunc("/v1/process-map/operational-relationships/", s.handleProcessMapOperationalRelationshipByID)
	mux.HandleFunc("/v1/huddle-logic-gates", s.handleHuddleLogicGates)
	mux.HandleFunc("/v1/huddle-logic-gates/", s.handleHuddleLogicGateByID)
	mux.HandleFunc("/v1/huddle-nodes", s.handleHuddleNodes)
	mux.HandleFunc("/v1/huddle-nodes/", s.handleHuddleNodeByID)
	mux.HandleFunc("/v1/kpis", s.handleKPIs)
	mux.HandleFunc("/v1/kpis/", s.handleKPIByID)
	mux.HandleFunc("/v1/huddle-explorer", s.handleHuddleExplorer)
	mux.HandleFunc("/v1/huddle-explorer/location-path", s.handleHuddleExplorerLocationPath)
	mux.HandleFunc("/v1/huddle-explorer/folders", s.handleHuddleExplorerFolders)
	mux.HandleFunc("/v1/huddle-explorer/folders/", s.handleHuddleExplorerFolderByID)
	mux.HandleFunc("/v1/huddle-explorer/items/", s.handleHuddleExplorerItemByID)
	mux.HandleFunc("/v2/gvic-matrix/nodes", s.handleRACIMatrixNodesV2)
	mux.HandleFunc("/v2/gvic-matrix/nodes/", s.handleRACIMatrixNodeByIDV2)
	mux.HandleFunc("/v1/work-items/responsible-inbox", s.handleWorkItemResponsibleInbox)
	mux.HandleFunc("/v1/work-items/aci-inbox", s.handleWorkItemACIInbox)
	mux.HandleFunc("/v1/work-items/my-nodes", s.handleWorkItemMyNodes)
	mux.HandleFunc("/v1/work-items/my-logic-gates", s.handleWorkItemMyLogicGates)
	mux.HandleFunc("/v1/work-items/gvic-matrix-projection", s.handleWorkItemRACIMatrixProjection)
	mux.HandleFunc("/v1/work-items/logic-gate-assignments/remove", s.handleWorkItemLogicGateAssignmentRemove)
	mux.HandleFunc("/v1/work-items/logic-gate-assignments/issue", s.handleWorkItemLogicGateAssignmentIssue)
	mux.HandleFunc("/v1/project-management/timeline", s.handleProjectManagementTimelineProjection)
	mux.HandleFunc("/v1/project-management/timeline-items", s.handleProjectManagementTimelineItems)
	mux.HandleFunc("/v1/project-management/timeline-items/", s.handleProjectManagementTimelineItemByID)
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
