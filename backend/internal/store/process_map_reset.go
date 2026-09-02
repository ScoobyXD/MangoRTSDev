package store

import (
	"fmt"
	"miraeopus/backend/internal/domain"
	"strings"
)

type processMapResetResource struct {
	ResourceType string
	ResourceID   string
	ParentID     string
}

// planProcessMapReset accepts canonical Explorer references in sibling order.
// Saved geometry is deliberately not an input: replay starts from an empty map.
func planProcessMapReset(companyID string, resources []processMapResetResource) ([]domain.ProcessMapPlacement, error) {
	if strings.TrimSpace(companyID) == "" {
		return nil, ErrInvalid
	}
	byKey := make(map[string]processMapResetResource, len(resources))
	folders := make(map[string]bool)
	children := make(map[string][]processMapResetResource)
	for _, resource := range resources {
		if resource.ResourceType != domain.ProcessMapResourceTypeFolder && resource.ResourceType != domain.ProcessMapResourceTypeProcess ||
			strings.TrimSpace(resource.ResourceID) == "" || strings.TrimSpace(resource.ResourceID) != resource.ResourceID ||
			strings.TrimSpace(resource.ParentID) != resource.ParentID {
			return nil, fmt.Errorf("process map reset resource %s/%s: %w", resource.ResourceType, resource.ResourceID, ErrInvalid)
		}
		key := processMapAutomaticPlacementKey(resource.ResourceType, resource.ResourceID)
		if _, exists := byKey[key]; exists {
			return nil, fmt.Errorf("process map reset duplicate %s/%s: %w", resource.ResourceType, resource.ResourceID, ErrInvalid)
		}
		byKey[key] = resource
		if resource.ResourceType == domain.ProcessMapResourceTypeFolder {
			folders[resource.ResourceID] = true
		}
		children[resource.ParentID] = append(children[resource.ParentID], resource)
	}
	for _, resource := range resources {
		if resource.ParentID != "" && !folders[resource.ParentID] {
			return nil, fmt.Errorf("process map reset parent %s: %w", resource.ParentID, ErrNotFound)
		}
	}

	// Complete every sibling group before placing descendants. Any later fitting
	// of that group then finishes before its folders receive their own children.
	ordered := make([]processMapResetResource, 0, len(resources))
	parents := []string{""}
	for index := 0; index < len(parents); index++ {
		for _, resource := range children[parents[index]] {
			ordered = append(ordered, resource)
			if resource.ResourceType == domain.ProcessMapResourceTypeFolder {
				parents = append(parents, resource.ResourceID)
			}
		}
	}
	if len(ordered) != len(resources) {
		return nil, ErrProcessMapCycle
	}

	placements := make([]domain.ProcessMapPlacement, 0, len(resources))
	indices := make(map[string]int, len(resources))
	for _, resource := range ordered {
		plan, err := planAutomaticProcessMapPlacement(companyID, resource.ResourceType, resource.ResourceID, resource.ParentID, placements)
		if err != nil {
			return nil, fmt.Errorf("process map reset placement %s/%s: %w", resource.ResourceType, resource.ResourceID, err)
		}
		for _, placement := range plan.Placements {
			key := processMapAutomaticPlacementKey(placement.ResourceType, placement.ResourceID)
			if index, exists := indices[key]; exists {
				placements[index] = placement
			} else {
				indices[key] = len(placements)
				placements = append(placements, placement)
			}
		}
	}

	if len(placements) != len(resources) {
		return nil, ErrInvalid
	}
	for _, resource := range resources {
		index, exists := indices[processMapAutomaticPlacementKey(resource.ResourceType, resource.ResourceID)]
		if !exists {
			return nil, ErrInvalid
		}
		placement := placements[index]
		if placement.CompanyID != companyID || processMapAutomaticParentID(placement) != resource.ParentID ||
			!validProcessMapGeometry(placement.GridX, placement.GridY, placement.GridWidth, placement.GridHeight) {
			return nil, ErrInvalid
		}
		if resource.ParentID != "" {
			parent := placements[indices[processMapAutomaticPlacementKey(domain.ProcessMapResourceTypeFolder, resource.ParentID)]]
			interior, _ := processMapAutomaticInterior(parent)
			if interior.GridWidth <= 0 || interior.GridHeight <= 0 ||
				!processMapBoundsContain(processMapPlacementBounds(interior), processMapPlacementBounds(placement)) {
				return nil, fmt.Errorf("process map reset containment %s/%s: %w", resource.ResourceType, resource.ResourceID, ErrProcessMapContainment)
			}
		}
	}
	for _, siblings := range children {
		for index, resource := range siblings {
			placement := placements[indices[processMapAutomaticPlacementKey(resource.ResourceType, resource.ResourceID)]]
			for _, other := range siblings[index+1:] {
				otherPlacement := placements[indices[processMapAutomaticPlacementKey(other.ResourceType, other.ResourceID)]]
				if processMapPlacementsConflictWithGap(placement, otherPlacement, 0) {
					return nil, fmt.Errorf("process map reset sibling overlap %s/%s and %s/%s: %w", resource.ResourceType, resource.ResourceID, other.ResourceType, other.ResourceID, ErrProcessMapContainment)
				}
			}
		}
	}
	return placements, nil
}
