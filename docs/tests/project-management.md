Last updated: 2026-06-20

# Project Management Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: 0% (rule IDs are not mapped to automated tests yet)

## Business Logic

PM1 - Listing projects requires company access.
PM2 - Project lists only include projects the viewer can access with view permission or higher.
PM3 - Creating a project requires a company ID and nonblank project name.
PM4 - Project creation stores project status, health, account IDs, and team IDs when those values are provided.
PM5 - Reading a project requires view access to that project.
PM6 - Project detail responses include project metadata, information/projections, relationships, critical path, counts, and edit/admin capability flags.
PM7 - Updating project metadata requires edit access to the project.
PM8 - Deleting a project requires admin access to the project.
PM9 - Project deletion uses the Company Explorer target deletion path so tree placement and project data are removed consistently.
PM10 - Adding or changing project information/projection rows requires edit access to the project.
PM11 - Deleting project information/projection rows requires edit access to the project.
PM12 - Listing project relationships requires view access to the project.
PM13 - Project relationship lists filter related nodes and logic gates by the viewer's access to those related resources.
PM14 - Creating a project relationship requires edit access to the project.
PM15 - Deleting a project relationship requires edit access to the project.
PM16 - Project relationships can target nodes and logic gates.
PM17 - Reading a project's critical path requires view access to the project.
PM18 - Critical path rows are filtered by the viewer's access to the underlying node or logic gate.
PM19 - Creating, updating, reordering, or deleting critical path rows requires edit access to the project.
PM20 - Critical path rows sort by position, then creation time, then ID.
PM21 - Creating a node from a project context requires edit access to the project and creates the project relationship.
PM22 - Creating a logic gate from a project context requires edit access to the project and creates the project relationship.
PM23 - Project-scoped creation can include initial information, account data, or assignment data and must keep those records tied to the created resource.
PM24 - Project Management timeline reads use the work-item read model with company, viewer, target user, scope, and sequence context.
PM25 - Timeline items can target only node or logic gate entities.
PM26 - Creating a timeline item requires access to the target entity and a valid start date.
PM27 - Timeline item duration is normalized into the supported range.
PM28 - A user can create timeline items for themself when entity access allows it.
PM29 - Creating timeline items for another user requires company manager authorization.
PM30 - Updating or deleting a timeline item requires authorization for the timeline item's owner.

## Scenarios

### Scenario PM-S1: Project Access, Create, Read, Update, Delete

Business logic covered:
- PM1
- PM2
- PM3
- PM4
- PM5
- PM6
- PM7
- PM8
- PM9

Given:
- A company has projects with different access grants for the viewer.
- A user can view one project, edit another project, and admin a third project.

Expected:
- The project list requires company access and returns only viewable projects.
- Creating a project fails without company ID or name.
- Creating a project stores provided status, health, accounts, and teams.
- Project detail requires view access and returns metadata, projections, relationships, critical path, counts, and capability flags.
- Updating metadata requires edit access.
- Deleting a project requires admin access and removes it through the Company Explorer target deletion path.

### Scenario PM-S2: Project Information, Relationships, And Critical Path

Business logic covered:
- PM10
- PM11
- PM12
- PM13
- PM14
- PM15
- PM16
- PM17
- PM18
- PM19
- PM20

Given:
- A project has information rows, node relationships, logic gate relationships, and critical path rows.
- The viewer can view the project but cannot view every related node or logic gate.

Expected:
- Information/projection mutations require edit access.
- Relationship listing requires project view access and hides related resources the viewer cannot view.
- Relationship create/delete requires project edit access.
- Relationships accept node and logic gate targets.
- Critical path listing requires project view access and hides inaccessible underlying resources.
- Critical path mutations require project edit access.
- Critical path ordering is deterministic by position, creation time, and ID.

### Scenario PM-S3: Project-Scoped Work Creation

Business logic covered:
- PM21
- PM22
- PM23

Given:
- A user creates a node or logic gate from inside a project.
- The request may include initial information, account data, or assignment data.

Expected:
- Creation requires project edit access.
- Created nodes and logic gates are related to the project.
- Initial information, account data, and assignment data are attached to the created resource and do not drift to another resource.

### Scenario PM-S4: Project Management Timeline

Business logic covered:
- PM24
- PM25
- PM26
- PM27
- PM28
- PM29
- PM30

Given:
- A user views Project Management timeline data for themself or another user.
- Timeline items target nodes or logic gates.

Expected:
- Timeline reads use the work-item read model with viewer, target user, scope, and sequence context.
- Timeline items reject entity types other than node and logic gate.
- Creating a timeline item requires entity access and a valid start date.
- Duration is normalized into the supported range.
- A user can create timeline items for themself when access allows.
- Creating for another user requires company manager authorization.
- Updating or deleting a timeline item requires authorization for the item owner's timeline.
