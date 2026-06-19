package store

import (
	"miraeopus/backend/internal/domain"
	"sort"
	"strings"
	"time"
)

type myWorkMatrixFlatRow struct {
	CompanyID                string
	UserID                   string
	Role                     string
	ResourceType             string
	ResourceID               string
	DisplayTitle             string
	Status                   *string
	DueDate                  *string
	Priority                 *int
	Accounts                 []domain.Account
	ResourceCreatedTimestamp time.Time
	ProjectID                string
	ProjectName              string
	LogicGateID              string
	LogicGateTitle           string
}

type myWorkMatrixCellBuilder struct {
	priority *int
	role     string
	roots    []*myWorkTreeNode
	byKey    map[string]*myWorkTreeNode
}

type myWorkTreeNode struct {
	item     MyWorkResourceTree
	children []*myWorkTreeNode
	byKey    map[string]*myWorkTreeNode
}

func buildMyWorkMatrixResponse(query WorkItemInboxQuery, rows []myWorkMatrixFlatRow) MyWorkMatrixResponse {
	cells := map[string]*myWorkMatrixCellBuilder{}
	for _, row := range rows {
		role, ok := NormalizeGVICRole(row.Role)
		if !ok {
			continue
		}
		priority := normalizeMyWorkCellPriority(row.Priority)
		cellKey := myWorkCellKey(role, priority)
		cell := cells[cellKey]
		if cell == nil {
			cell = &myWorkMatrixCellBuilder{priority: cloneIntPointer(priority), role: role, byKey: map[string]*myWorkTreeNode{}}
			if priority == nil {
				cell.priority = nil
			}
			cells[cellKey] = cell
		}
		addMyWorkFlatRowToCell(cell, row)
	}

	out := make([]MyWorkMatrixCell, 0, len(cells))
	for _, cell := range cells {
		roots := make([]MyWorkResourceTree, 0, len(cell.roots))
		for _, root := range cell.roots {
			roots = append(roots, root.toDTO())
		}
		out = append(out, MyWorkMatrixCell{Priority: cloneIntPointer(cell.priority), Role: cell.role, Roots: roots})
	}
	sort.Slice(out, func(i, j int) bool {
		leftRole := gvicRoleSortValue(out[i].Role)
		rightRole := gvicRoleSortValue(out[j].Role)
		if leftRole != rightRole {
			return leftRole < rightRole
		}
		leftPriority := myWorkPrioritySort(out[i].Priority)
		rightPriority := myWorkPrioritySort(out[j].Priority)
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		return out[i].Role < out[j].Role
	})
	return MyWorkMatrixResponse{CompanyID: query.CompanyID, UserID: query.UserID, Cells: out}
}

func addMyWorkFlatRowToCell(cell *myWorkMatrixCellBuilder, row myWorkMatrixFlatRow) {
	switch row.ResourceType {
	case EntityTypeProject:
		getOrAddMyWorkRoot(cell, myWorkProjectTree(row))
	case EntityTypeLogicGate:
		if strings.TrimSpace(row.ProjectID) != "" {
			project := getOrAddMyWorkRoot(cell, myWorkProjectTree(row))
			getOrAddMyWorkChild(project, myWorkLogicGateTree(row))
			return
		}
		getOrAddMyWorkRoot(cell, myWorkLogicGateTree(row))
	case EntityTypeNode:
		node := myWorkNodeTree(row)
		if strings.TrimSpace(row.ProjectID) != "" {
			project := getOrAddMyWorkRoot(cell, myWorkProjectTree(row))
			if strings.TrimSpace(row.LogicGateID) != "" {
				gate := getOrAddMyWorkChild(project, myWorkLogicGateTree(row))
				getOrAddMyWorkChild(gate, node)
				return
			}
			getOrAddMyWorkChild(project, node)
			return
		}
		if strings.TrimSpace(row.LogicGateID) != "" {
			gate := getOrAddMyWorkRoot(cell, myWorkLogicGateTree(row))
			getOrAddMyWorkChild(gate, node)
			return
		}
		getOrAddMyWorkRoot(cell, node)
	}
}

func getOrAddMyWorkRoot(cell *myWorkMatrixCellBuilder, item MyWorkResourceTree) *myWorkTreeNode {
	keyValue := myWorkTreeKey(item)
	if existing := cell.byKey[keyValue]; existing != nil {
		mergeMyWorkTreeItem(existing, item)
		return existing
	}
	node := &myWorkTreeNode{item: item, byKey: map[string]*myWorkTreeNode{}}
	cell.byKey[keyValue] = node
	cell.roots = append(cell.roots, node)
	return node
}

func getOrAddMyWorkChild(parent *myWorkTreeNode, item MyWorkResourceTree) *myWorkTreeNode {
	keyValue := myWorkTreeKey(item)
	if existing := parent.byKey[keyValue]; existing != nil {
		mergeMyWorkTreeItem(existing, item)
		return existing
	}
	node := &myWorkTreeNode{item: item, byKey: map[string]*myWorkTreeNode{}}
	parent.byKey[keyValue] = node
	parent.children = append(parent.children, node)
	return node
}

func mergeMyWorkTreeItem(node *myWorkTreeNode, item MyWorkResourceTree) {
	if strings.TrimSpace(node.item.Name) == "" {
		node.item.Name = item.Name
	}
	if node.item.Status == nil {
		node.item.Status = cloneStringPointer(item.Status)
	}
	if node.item.DueDate == nil {
		node.item.DueDate = cloneStringPointer(item.DueDate)
	}
	if node.item.Priority == nil {
		node.item.Priority = cloneIntPointer(item.Priority)
	}
	if len(node.item.Accounts) == 0 {
		node.item.Accounts = cloneAccountSnapshots(item.Accounts)
	}
	if node.item.ResourceCreatedTimestamp.IsZero() {
		node.item.ResourceCreatedTimestamp = item.ResourceCreatedTimestamp
	}
}

func (node *myWorkTreeNode) toDTO() MyWorkResourceTree {
	item := node.item
	children := make([]MyWorkResourceTree, 0, len(node.children))
	for _, child := range node.children {
		children = append(children, child.toDTO())
	}
	sort.Slice(children, func(i, j int) bool {
		return myWorkTreeSort(children[i], children[j])
	})
	item.Children = children
	return item
}

func myWorkProjectTree(row myWorkMatrixFlatRow) MyWorkResourceTree {
	projectID := firstNonEmpty(row.ProjectID, row.ResourceID)
	return MyWorkResourceTree{
		Kind:                     EntityTypeProject,
		ResourceID:               projectID,
		ProjectID:                projectID,
		Name:                     firstNonEmpty(row.ProjectName, row.DisplayTitle, projectID, "Project"),
		Status:                   cloneStringPointer(row.Status),
		ResourceCreatedTimestamp: row.ResourceCreatedTimestamp,
		Children:                 []MyWorkResourceTree{},
	}
}

func myWorkLogicGateTree(row myWorkMatrixFlatRow) MyWorkResourceTree {
	logicGateID := firstNonEmpty(row.LogicGateID, row.ResourceID)
	return MyWorkResourceTree{
		Kind:                     EntityTypeLogicGate,
		ResourceID:               logicGateID,
		LogicGateID:              logicGateID,
		Name:                     firstNonEmpty(row.LogicGateTitle, row.DisplayTitle, logicGateID, "Logic Gate"),
		ResourceCreatedTimestamp: row.ResourceCreatedTimestamp,
		Children:                 []MyWorkResourceTree{},
	}
}

func myWorkNodeTree(row myWorkMatrixFlatRow) MyWorkResourceTree {
	return MyWorkResourceTree{
		Kind:                     EntityTypeNode,
		ResourceID:               row.ResourceID,
		NodeID:                   row.ResourceID,
		Name:                     firstNonEmpty(row.DisplayTitle, row.ResourceID, "Node"),
		Status:                   cloneStringPointer(row.Status),
		DueDate:                  cloneStringPointer(row.DueDate),
		Priority:                 cloneIntPointer(row.Priority),
		Accounts:                 cloneAccountSnapshots(row.Accounts),
		ResourceCreatedTimestamp: row.ResourceCreatedTimestamp,
		Children:                 []MyWorkResourceTree{},
	}
}

func myWorkTreeKey(item MyWorkResourceTree) string {
	return item.Kind + ":" + item.ResourceID
}

func myWorkTreeSort(left, right MyWorkResourceTree) bool {
	leftKind := updateGroupFieldSort(left.Kind)
	rightKind := updateGroupFieldSort(right.Kind)
	if leftKind != rightKind {
		return leftKind < rightKind
	}
	leftPriority := myWorkPrioritySort(left.Priority)
	rightPriority := myWorkPrioritySort(right.Priority)
	if leftPriority != rightPriority {
		return leftPriority < rightPriority
	}
	leftName := strings.ToLower(strings.TrimSpace(left.Name))
	rightName := strings.ToLower(strings.TrimSpace(right.Name))
	if leftName != rightName {
		return leftName < rightName
	}
	return left.ResourceID < right.ResourceID
}

func normalizeMyWorkCellPriority(priority *int) *int {
	if priority == nil || *priority <= 0 {
		return nil
	}
	value := *priority
	if value < 1 {
		value = 1
	}
	if value > 5 {
		value = 5
	}
	return &value
}

func myWorkCellKey(role string, priority *int) string {
	if priority == nil {
		return role + ":none"
	}
	return role + ":" + string(rune('0'+*priority))
}

func myWorkPrioritySort(priority *int) int {
	if priority == nil || *priority <= 0 {
		return 6
	}
	if *priority > 5 {
		return 5
	}
	return *priority
}
