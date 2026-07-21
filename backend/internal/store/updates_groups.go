package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

const (
	UpdatesFilterAll     = "all"
	UpdatesFilterUrgent  = "urgent"
	UpdatesFilterMention = "mention"
	UpdatesFilterUpdate  = "update"

	updatesGroupFieldUpdate = "update"
)

type updatesProjectContext struct {
	ProjectID    string
	ProjectName  string
	Position     int
	Created      time.Time
	Relationship string
}

type updatesBuildContext struct {
	NodeLabels               map[string]string
	LogicGateLabels          map[string]string
	ProjectLabels            map[string]string
	NodeLogicGateIDs         map[string]string
	NodeProjectContexts      map[string][]updatesProjectContext
	LogicGateProjectContexts map[string][]updatesProjectContext
}

type updatesLayer struct {
	Field        string
	ResourceType string
	ResourceID   string
	Key          string
	Label        string
}

type updatesTreeGroup struct {
	item     UpdatesNestedGroup
	children map[string]*updatesTreeGroup
}

func normalizeUpdatesFilter(filter string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(filter)) {
	case "", UpdatesFilterAll:
		return UpdatesFilterAll, true
	case UpdatesFilterUrgent:
		return UpdatesFilterUrgent, true
	case UpdatesFilterMention:
		return UpdatesFilterMention, true
	case UpdatesFilterUpdate, "updates":
		return UpdatesFilterUpdate, true
	default:
		return "", false
	}
}

func normalizeUpdatesQuery(input UpdatesQuery) (UpdatesQuery, string, error) {
	input.UserID = strings.TrimSpace(input.UserID)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.RootID = strings.TrimSpace(input.RootID)
	filter, ok := normalizeUpdatesFilter(input.Filter)
	if input.UserID == "" || input.CompanyID == "" || !ok {
		return UpdatesQuery{}, "", ErrInvalid
	}
	if !input.SeenOnly {
		input.CreatedFrom = time.Time{}
		input.CreatedTo = time.Time{}
		return input, filter, nil
	}
	input.CreatedFrom = input.CreatedFrom.UTC()
	input.CreatedTo = input.CreatedTo.UTC()
	if input.CreatedFrom.IsZero() || input.CreatedTo.IsZero() || !input.CreatedFrom.Before(input.CreatedTo) || input.CreatedTo.Sub(input.CreatedFrom) > UpdatesSeenMaxWindow {
		return UpdatesQuery{}, "", ErrInvalid
	}
	return input, filter, nil
}

func updateNotificationMatchesView(item domain.Notification, input UpdatesQuery) bool {
	if input.SeenOnly {
		return item.ReadTimestamp != nil && !item.CreatedTimestamp.Before(input.CreatedFrom) && item.CreatedTimestamp.Before(input.CreatedTo)
	}
	return item.ReadTimestamp == nil
}

func updatesNotificationMatchesFilter(item domain.Notification, filter string) bool {
	switch filter {
	case UpdatesFilterAll:
		return true
	case UpdatesFilterUrgent:
		return item.Type == domain.NotificationEventUrgentMentionCreated
	case UpdatesFilterMention:
		return item.Type == domain.NotificationEventMentionCreated
	case UpdatesFilterUpdate:
		return item.Type != domain.NotificationEventMentionCreated && item.Type != domain.NotificationEventUrgentMentionCreated
	default:
		return false
	}
}

func buildUpdateRootGroups(items []domain.Notification, ctx updatesBuildContext) []UpdatesNestedGroup {
	roots := buildUpdateGroups(items, ctx)
	for index := range roots {
		roots[index].Groups = []UpdatesNestedGroup{}
		roots[index].Notifications = nil
	}
	return roots
}

func buildUpdateBranch(items []domain.Notification, ctx updatesBuildContext, rootID string) (UpdatesNestedGroup, error) {
	rootID = strings.TrimSpace(rootID)
	if rootID == "" {
		return UpdatesNestedGroup{}, ErrInvalid
	}
	for _, root := range buildUpdateGroups(items, ctx) {
		if root.ID == rootID {
			return root, nil
		}
	}
	return UpdatesNestedGroup{}, ErrNotFound
}

func buildUpdateGroups(items []domain.Notification, ctx updatesBuildContext) []UpdatesNestedGroup {
	rootMap := map[string]*updatesTreeGroup{}
	for _, item := range sortUpdateNotifications(items) {
		for _, path := range updatePathsForNotification(item, ctx) {
			addUpdatePath(rootMap, path, item)
		}
	}
	return updateTreeGroupSlice(rootMap)
}

func updatePathsForNotification(item domain.Notification, ctx updatesBuildContext) [][]updatesLayer {
	nodeID := strings.TrimSpace(item.NodeID)
	if nodeID == "" && strings.TrimSpace(item.EntityType) == EntityTypeNode {
		nodeID = strings.TrimSpace(item.EntityID)
	}
	logicGateID := strings.TrimSpace(item.LogicGateID)
	if logicGateID == "" && strings.TrimSpace(item.EntityType) == EntityTypeLogicGate {
		logicGateID = strings.TrimSpace(item.EntityID)
	}
	if logicGateID == "" && nodeID != "" {
		logicGateID = strings.TrimSpace(ctx.NodeLogicGateIDs[nodeID])
	}
	projectID := ""
	if strings.TrimSpace(item.EntityType) == EntityTypeProject {
		projectID = strings.TrimSpace(item.EntityID)
	}

	paths := make([][]updatesLayer, 0)
	if contexts := updateProjectContextsForNotification(nodeID, logicGateID, ctx); len(contexts) > 0 {
		for _, project := range contexts {
			path := []updatesLayer{updateProjectLayer(project.ProjectID, firstNonEmpty(project.ProjectName, ctx.ProjectLabels[project.ProjectID], item.Title))}
			if logicGateID != "" {
				path = append(path, updateLogicGateLayer(logicGateID, firstNonEmpty(ctx.LogicGateLabels[logicGateID], item.Title)))
			}
			if nodeID != "" {
				path = append(path, updateNodeLayer(nodeID, firstNonEmpty(ctx.NodeLabels[nodeID], item.Title)))
			}
			paths = append(paths, path)
		}
	}
	if projectID != "" && len(paths) == 0 {
		paths = append(paths, []updatesLayer{updateProjectLayer(projectID, firstNonEmpty(ctx.ProjectLabels[projectID], item.Title))})
	}
	if len(paths) == 0 {
		path := make([]updatesLayer, 0, 2)
		if logicGateID != "" {
			path = append(path, updateLogicGateLayer(logicGateID, firstNonEmpty(ctx.LogicGateLabels[logicGateID], item.Title)))
		}
		if nodeID != "" {
			path = append(path, updateNodeLayer(nodeID, firstNonEmpty(ctx.NodeLabels[nodeID], item.Title)))
		}
		if len(path) == 0 {
			path = append(path, updatesFallbackLayer())
		}
		paths = append(paths, path)
	}
	return uniqueUpdatePaths(paths)
}

func updateProjectContextsForNotification(nodeID, logicGateID string, ctx updatesBuildContext) []updatesProjectContext {
	out := make([]updatesProjectContext, 0)
	seen := map[string]bool{}
	add := func(project updatesProjectContext) {
		project.ProjectID = strings.TrimSpace(project.ProjectID)
		if project.ProjectID == "" {
			return
		}
		keyValue := project.ProjectID + "\x00" + strings.TrimSpace(project.Relationship)
		if seen[keyValue] {
			return
		}
		seen[keyValue] = true
		out = append(out, project)
	}
	for _, project := range ctx.NodeProjectContexts[nodeID] {
		add(project)
	}
	for _, project := range ctx.LogicGateProjectContexts[logicGateID] {
		add(project)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Position != out[j].Position {
			return out[i].Position < out[j].Position
		}
		if strings.ToLower(out[i].ProjectName) != strings.ToLower(out[j].ProjectName) {
			return strings.ToLower(out[i].ProjectName) < strings.ToLower(out[j].ProjectName)
		}
		if !out[i].Created.Equal(out[j].Created) {
			return out[i].Created.Before(out[j].Created)
		}
		if out[i].Relationship != out[j].Relationship {
			return out[i].Relationship < out[j].Relationship
		}
		return out[i].ProjectID < out[j].ProjectID
	})
	return out
}

func uniqueUpdatePaths(paths [][]updatesLayer) [][]updatesLayer {
	out := make([][]updatesLayer, 0, len(paths))
	seen := map[string]bool{}
	for _, path := range paths {
		parts := make([]string, 0, len(path))
		for _, layer := range path {
			parts = append(parts, layer.Key)
		}
		keyValue := strings.Join(parts, "\x00")
		if seen[keyValue] {
			continue
		}
		seen[keyValue] = true
		out = append(out, path)
	}
	return out
}

func updateProjectLayer(projectID, label string) updatesLayer {
	projectID = strings.TrimSpace(projectID)
	return updatesLayer{
		Field:        EntityTypeProject,
		ResourceType: EntityTypeProject,
		ResourceID:   projectID,
		Key:          EntityTypeProject + ":" + projectID,
		Label:        firstNonEmpty(label, "Project"),
	}
}

func updateLogicGateLayer(logicGateID, label string) updatesLayer {
	logicGateID = strings.TrimSpace(logicGateID)
	return updatesLayer{
		Field:        EntityTypeLogicGate,
		ResourceType: EntityTypeLogicGate,
		ResourceID:   logicGateID,
		Key:          EntityTypeLogicGate + ":" + logicGateID,
		Label:        firstNonEmpty(label, "Logic Gate"),
	}
}

func updateNodeLayer(nodeID, label string) updatesLayer {
	nodeID = strings.TrimSpace(nodeID)
	return updatesLayer{
		Field:        EntityTypeNode,
		ResourceType: EntityTypeNode,
		ResourceID:   nodeID,
		Key:          EntityTypeNode + ":" + nodeID,
		Label:        firstNonEmpty(label, "Node"),
	}
}

func updatesFallbackLayer() updatesLayer {
	return updatesLayer{
		Field: updatesGroupFieldUpdate,
		Key:   updatesGroupFieldUpdate + ":all",
		Label: "Updates",
	}
}

func addUpdatePath(rootMap map[string]*updatesTreeGroup, path []updatesLayer, item domain.Notification) {
	var currentMap = rootMap
	parentID := "updates"
	for depth, layer := range path {
		id := parentID + "/" + layer.Key
		group, ok := currentMap[layer.Key]
		if !ok {
			group = &updatesTreeGroup{
				item: UpdatesNestedGroup{
					ID:           id,
					Key:          layer.Key,
					Field:        layer.Field,
					Label:        layer.Label,
					ResourceType: layer.ResourceType,
					ResourceID:   layer.ResourceID,
					Depth:        depth,
					Groups:       []UpdatesNestedGroup{},
				},
				children: map[string]*updatesTreeGroup{},
			}
			currentMap[layer.Key] = group
		}
		if strings.TrimSpace(group.item.Label) == "" {
			group.item.Label = layer.Label
		}
		parentID = id
		currentMap = group.children
		if depth == len(path)-1 {
			group.item.Notifications = append(group.item.Notifications, cloneNotification(item))
		}
	}
}

func updateTreeGroupSlice(items map[string]*updatesTreeGroup) []UpdatesNestedGroup {
	out := make([]UpdatesNestedGroup, 0, len(items))
	for _, item := range items {
		group := item.item
		group.Groups = updateTreeGroupSlice(item.children)
		group.Notifications = sortUpdateNotifications(group.Notifications)
		out = append(out, group)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Field != out[j].Field {
			return updateGroupFieldSort(out[i].Field) < updateGroupFieldSort(out[j].Field)
		}
		left := strings.ToLower(out[i].Label)
		right := strings.ToLower(out[j].Label)
		if left != right {
			return left < right
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func updateGroupFieldSort(field string) int {
	switch field {
	case EntityTypeProject:
		return 1
	case EntityTypeLogicGate:
		return 2
	case EntityTypeNode:
		return 3
	default:
		return 4
	}
}

func sortUpdateNotifications(items []domain.Notification) []domain.Notification {
	out := append([]domain.Notification(nil), items...)
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CreatedTimestamp.Equal(out[j].CreatedTimestamp) {
			return out[i].CreatedTimestamp.After(out[j].CreatedTimestamp)
		}
		if out[i].Title != out[j].Title {
			return strings.ToLower(out[i].Title) < strings.ToLower(out[j].Title)
		}
		return out[i].NotificationID < out[j].NotificationID
	})
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if clean := strings.TrimSpace(value); clean != "" {
			return clean
		}
	}
	return ""
}
