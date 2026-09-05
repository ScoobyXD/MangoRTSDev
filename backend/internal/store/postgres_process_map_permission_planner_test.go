package store

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func TestPostgresProcessMapPermissionPlannerMigrationPreservesResolution(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	const signature = "mangorts_v2_resolve_permission_policy(uuid,text,uuid)"
	var expectedDefinition, expectedParentDefinition, originalACL string
	var originalOID uint32
	if err := db.QueryRow(`select pg_get_functiondef($1::regprocedure),$1::regprocedure::oid,coalesce(proacl::text,'') from pg_proc where oid=$1::regprocedure`, signature).Scan(&expectedDefinition, &originalOID, &originalACL); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select pg_get_functiondef('mangorts_v2_policy_parent(uuid,text,uuid)'::regprocedure)`).Scan(&expectedParentDefinition); err != nil {
		t.Fatal(err)
	}
	// Exercise the actual historical resolver before applying the forward migration.
	historical, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260805_zzzc_v2_gvic_permissions_step2_cutover.sql"))
	if err != nil {
		t.Fatal(err)
	}
	start := strings.Index(string(historical), "create or replace function mangorts_v2_resolve_permission_policy(")
	if start < 0 {
		t.Fatal("historical permission resolver not found")
	}
	end := strings.Index(string(historical)[start:], "$$;")
	if end < 0 {
		t.Fatal("historical permission resolver is incomplete")
	}
	if _, err := db.Exec(string(historical)[start : start+end+3]); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`alter function mangorts_v2_policy_parent(uuid,text,uuid) rows 1000; alter function mangorts_v2_resolve_permission_policy(uuid,text,uuid) rows 1000`); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", "20260905_process_map_permission_query_plans.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for _, phase := range []string{"before", "after"} {
		if phase == "after" {
			if _, err := db.Exec(string(migration)); err != nil {
				t.Fatal(err)
			}
		}
		company, err := repo.CreateCompany("Permission planner " + phase)
		if err != nil {
			t.Fatal(err)
		}
		newUser := func(name, role string) domain.User {
			t.Helper()
			user, err := repo.UpsertAuthUser("permission-plan-"+phase+name, "permission-plan-"+phase+name+"@example.test", name)
			if err != nil {
				t.Fatal(err)
			}
			if role != "" {
				if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, role); err != nil {
					t.Fatal(err)
				}
			}
			return user
		}
		admin, viewer, outsider := newUser("admin", domain.RoleCompanyAdmin), newUser("viewer", domain.RoleCompanyUser), newUser("outsider", "")
		parent, err := repo.CreateCompanyExplorerFolder(company.CompanyID, "", "logic_gate", "Policy parent")
		if err != nil {
			t.Fatal(err)
		}
		child, err := repo.CreateCompanyExplorerFolder(company.CompanyID, parent.FolderID, "logic_gate", "Policy child")
		if err != nil {
			t.Fatal(err)
		}
		gate, err := repo.CreateLogicGate(company.CompanyID, "Inherited gate")
		if err != nil {
			t.Fatal(err)
		}
		exec := func(query string, args ...any) {
			t.Helper()
			if _, err := db.Exec(query, args...); err != nil {
				t.Fatal(err)
			}
		}
		exec(`update company_explorer_items set parent_folder_id=$3::uuid where company_id=$1::uuid and target_type='logic_gate' and target_id=$2::uuid`, company.CompanyID, gate.LogicGateID, child.FolderID)
		exec(`update resource_permission_settings set permission_mode='inherited',customized_sequence=null,default_access=null where company_id=$1::uuid and ((resource_type='logic_gate' and resource_id=$2::uuid) or (resource_type='company_explorer_folder' and resource_id=$3::uuid))`, company.CompanyID, gate.LogicGateID, child.FolderID)
		exec(`update resource_permission_settings set default_access='no_access' where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`, company.CompanyID, parent.FolderID)
		check := func(name, userID, access string, want bool) {
			t.Helper()
			var allowed bool
			if err := db.QueryRow(`select mangorts_user_can_access_resource($1::uuid,'logic_gate',$2::uuid,$3::uuid,$4)`, company.CompanyID, gate.LogicGateID, userID, access).Scan(&allowed); err != nil || allowed != want {
				t.Fatalf("%s/%s access=%t err=%v, want %t", phase, name, allowed, err, want)
			}
		}
		check("inherited denial", viewer.UserID, "edit", false)
		check("company administrator", admin.UserID, "edit", true)
		check("no membership", outsider.UserID, "edit", false)
		check("unsupported access level", admin.UserID, "view", false)
		globalAdmin := newUser("global-admin", "")
		otherCompany, err := repo.CreateCompany("Global administrator " + phase)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := repo.AddCompanyMembership(globalAdmin.CognitoSubject, otherCompany.CompanyID, domain.RoleDevAdmin); err != nil {
			t.Fatal(err)
		}
		check("global administrator", globalAdmin.UserID, "edit", true)
		exec(`update resource_permission_settings set permission_mode='customized',default_access='edit',customized_sequence=nextval('resource_permission_change_sequence') where company_id=$1::uuid and resource_type='logic_gate' and resource_id=$2::uuid`, company.CompanyID, gate.LogicGateID)
		check("customized descendant", viewer.UserID, "edit", true)
		exec(`update resource_permission_settings set descendant_reset_sequence=nextval('resource_permission_change_sequence') where company_id=$1::uuid and resource_type='company_explorer_folder' and resource_id=$2::uuid`, company.CompanyID, parent.FolderID)
		check("ancestor reset", viewer.UserID, "edit", false)
		exec(`update company_explorer_items set parent_folder_id=null where company_id=$1::uuid and target_type='logic_gate' and target_id=$2::uuid`, company.CompanyID, gate.LogicGateID)
		check("detached inherited policy", viewer.UserID, "edit", false)
		// Existing cycle validation must still reject the relationship change.
		if _, err := db.Exec(`update company_explorer_folders set parent_folder_id=$3::uuid where company_id=$1::uuid and folder_id=$2::uuid`, company.CompanyID, parent.FolderID, child.FolderID); err == nil || !strings.Contains(err.Error(), "v2_policy_resource_cycle") {
			t.Fatalf("%s cycle mutation error=%v, want existing cycle rejection", phase, err)
		}
		var parentAfter *string
		if err := db.QueryRow(`select parent_folder_id::text from company_explorer_folders where company_id=$1::uuid and folder_id=$2::uuid`, company.CompanyID, parent.FolderID).Scan(&parentAfter); err != nil || parentAfter != nil {
			t.Fatalf("%s rejected cycle changed parent: %v, err=%v", phase, parentAfter, err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		var count int
		err = db.QueryRowContext(ctx, `select count(*) from mangorts_v2_resolve_permission_policy($1::uuid,'company_explorer_folder',$2::uuid)`, company.CompanyID, child.FolderID).Scan(&count)
		cancel()
		if err != nil || count > 1 {
			t.Fatalf("%s cycle resolution count=%d err=%v", phase, count, err)
		}
	}
	var actualDefinition, actualParentDefinition, actualACL string
	var actualOID uint32
	if err := db.QueryRow(`select pg_get_functiondef($1::regprocedure),$1::regprocedure::oid,coalesce(proacl::text,'') from pg_proc where oid=$1::regprocedure`, signature).Scan(&actualDefinition, &actualOID, &actualACL); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`select pg_get_functiondef('mangorts_v2_policy_parent(uuid,text,uuid)'::regprocedure)`).Scan(&actualParentDefinition); err != nil {
		t.Fatal(err)
	}
	if actualDefinition != expectedDefinition || actualParentDefinition != expectedParentDefinition || actualOID != originalOID || actualACL != originalACL {
		t.Fatal("migration must match canonical signatures, bodies, row estimates, STABLE/search_path, function identity and ACL")
	}
}
