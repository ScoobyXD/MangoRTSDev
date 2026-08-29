# My Work Business Logic Laws

Last updated: 2026-08-28

MW1 - The page is named My Work and is the first built-in item beneath My Tower, immediately above Projects.

MW2 - The first version always uses the authenticated company member as its subject. Me, Team, Company, another-person, and Assigned by me perspectives are later capabilities and do not appear in the first version.

MW3 - The My Work header shows the page title and has no grouping button.

MW4 - Beneath the header, My Work has three columns: an unnamed left column, Processes in the middle, and Projects on the right.

MW5 - The left column has no shared Work title or other unified section name. It contains an Action Items section followed by a Nodes section.

MW6 - Action Items and Nodes are permanent separate top-level sections. Grouping never mixes an Action Item with a Node or moves Nodes above Action Items.

MW7 - The left column shows only work assigned to the current subject. Work assigned by the subject is outside the first version.

MW8 - A Node is assigned to the subject only when that user has the current effective Responsible role, whether the role comes directly, through a group, or through RACI inheritance.

MW9 - Accountable, Consulted, or Informed status alone does not place a Node in the left-column Nodes section.

MW10 - An Action Item is assigned to the subject only when its exact Person in charge field stores that user's current company-member ID. Creator metadata is not an assignment.

MW11 - The Action Items section and Nodes section each own an independent grouping stack and an independent grouping button. Both buttons use the approved staggered three-line grouping icon.

MW12 - No grouping control outside those two section headers changes either section's grouping stack.

MW13 - The first Action Item grouping stack is Color followed by Completion due date.

MW14 - The initial Action Item color order is Red, Yellow, then No color. An Action Item with no color remains visible.

MW15 - The first Node grouping stack is Priority followed by Due date. The first version adds no relative date buckets such as Overdue, Today, This week, or Later.

MW16 - A Node with no Priority or no Due date remains visible under its exact empty-value group.

MW17 - Every Node row starts with the Node icon and exact current Node name.

MW18 - When a Node has an associated Process, its row shows the Process icon and exact current Process name inline. When it has an associated Project, its row shows the Project icon and exact current Project name inline.

MW19 - Clicking a Node row opens that exact Node. Clicking an Action Item row opens that exact Action Item.

MW20 - Every Process and Project row is clickable and opens that exact Process or Project.

MW21 - An inline Process or Project reference inside another row is independently clickable and opens that exact resource without also opening the surrounding row.

MW22 - The middle column has one R, A, C, I role selector. Exactly one role is active, Responsible is active by default, and the column lists the Processes for which the subject has that current effective RACI role.

MW23 - The right column lists the Projects whose current Team assignment includes the subject through current company-team membership.

MW24 - My Work reads canonical Nodes, Action Items, RACI, Process relationships, Project relationships, Project Team assignments, and company membership when a view is requested. There is no My Work projection table and no My Work relationship authority.

MW25 - My Work is a read surface. Opening, grouping, or viewing My Work never rewrites a Node, Action Item, RACI assignment, Process relationship, Project relationship, Project Team assignment, permission, or source record.

MW26 - The subject determines which resources qualify for My Work, while the authenticated viewer's current permissions determine which qualifying resources may be disclosed. The subject and viewer are the same authenticated company member in the first version.

MW27 - A qualifying Node, Process, or Project is shown only when the authenticated viewer has current effective access to that exact resource. Action Item visibility follows the current company-scoped Entity access contract.

MW28 - Effective RACI and Project Team membership never grant resource access. They only make a resource a My Work candidate.

MW29 - Access to a Node does not grant access to its associated Process or Project. An inaccessible inline Process or Project is omitted completely, including its ID, name, hidden count, placeholder, and relationship details, while the accessible Node remains visible.

MW30 - Permission filtering occurs before grouping, sorting, limits, pagination cursors, has-more decisions, or counts. The frontend never receives hidden resources for local filtering.

MW31 - Opening any My Work resource performs that destination's normal current permission check. A prior My Work response is never proof of continued access.

MW32 - A permission-resolution failure fails the My Work read closed. My Work never returns an unfiltered partial result after an authorization error.

## Process Story: One person sees assigned work and current company context

A company member opens My Work beneath My Tower

↓

Mango reads that member's current effectively Responsible Nodes and exact Person-in-charge Action Items from their canonical sources, then applies the authenticated viewer's current permissions before any result is grouped or paged

↓

The unnamed left column keeps Action Items above Nodes and applies each section's independent grouping stack

↓

The middle column defaults to the member's Responsible Processes and can switch among R, A, C, and I, while the right column lists Projects whose Team includes that member

↓

Every displayed Node, Action Item, Process, Project, and inline resource reference opens its exact canonical resource without changing source data
