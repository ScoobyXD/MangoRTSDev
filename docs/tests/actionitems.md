# Action Item Business Logic Laws

Last updated: 2026-08-29

1. Every company has one required Action Item Entity Type and the seven required fields `person_in_charge`, `assigned_by`, `analysis_due_date`, `completion_due_date`, `status`, `color`, and `source`.
2. Person in charge and Assigned by are independent nullable `person` fields. Each nonnull value is the exact `user_id` of a current membership in the Action Item's company.
3. Assigned by is editable business attribution. It defaults to null and is never inferred or backfilled from `entities.created_by_user_id`.
4. `entities.created_by_user_id` remains automatic nullable creator audit metadata even though the compact Action Item editor does not display Created by.
5. Direct Action Item creation from Entities remains allowed and creates the required Source field with a null value. Existing Action Items receive the same required null Source field without any inferred backfill.
6. Highlighted-text Action Item creation is supported only in Node, Process, Project, Huddle Node, Huddle Process, and KPI editors and records that exact owning resource as Source.
7. Source is the nullable value of the required `source` / `Source` / `resource` system Entity Field. A nonnull value contains exactly `{resource_type, resource_id}` for one canonical same-company endpoint; it is not an `entity_relationships` edge and stores no copied name.
8. The only Source resource types are `node`, `logic_gate`, `project`, `huddle_node`, `huddle_logic_gate`, and `kpi`.
9. Action Item creation validates the exact same-company source endpoint and the actor's current Edit access and commits the Action Item and all seven required fields, including Source, in one transaction.
10. Source grants no access. A viewer receives a clickable Source only while the exact endpoint exists and the viewer has current access; activating it opens that exact current resource through the established resource-opening behavior. Otherwise the UI shows a neutral unavailable or Not set state without the hidden type, ID, or name.
11. A displayed Source resolves the endpoint's current name and canonical icon. Renaming the source changes the displayed name without rewriting Source.
12. Removing or moving an inline Action Item chip never changes Source. The chip's live Huddle relationship and the Action Item's creation-provenance field have separate meanings.
13. Recycling a source endpoint preserves the exact Source field value but projects it as unavailable. Restoring that exact endpoint makes the current Source available again; permanently deleting it atomically clears matching Source values so no stale typed reference remains. This lifecycle cleanup is the only allowed post-creation Source mutation.
14. Details is the full-width field at the top of the compact editor. Beneath it are exactly two four-row columns: Person in charge, Assigned by, Created date, Source on the left; Color, Analysis due date, Completion due date, Status on the right.
15. Created date and Source are read-only. Person in charge and Assigned by use the same current-company searchable person picker with field-specific labels and accessible text.
16. Status uses the elevated custom choice listbox, visibly responds to hover and focus, supports keyboard selection and dismissal, preserves the exact `in_progress`, `pending`, and `done` keys, and keeps the existing serialized autosave behavior.
17. New Action Items default Status to In progress. Person in charge, Assigned by, and both due dates start unset. Direct creation starts with Source and Color unset, while editor creation atomically records the exact Source and uses the selected Yellow or Red color.
18. My Work Mine contains only active Action Items whose exact Person in charge is the current member. Delegated contains only active Action Items whose exact Assigned by is the current member and whose nonnull Person in charge is a different member.
19. A self-assigned Action Item appears only in Mine. An unassigned Action Item appears in neither Mine nor Delegated, and Done, Complete, or Completed items appear in neither active view.
20. Perspective filtering, permission checks, color/date ordering, grouping, limits, counts, and cursor pagination are server-owned in that order, and each cursor is bound to its perspective.

## Process Story

An authorized editor selection creates one Action Item and its exact typed Source atomically. The later editor save inserts the normal inline Entity chip. The compact editor resolves the current source name only for an authorized viewer, while Mine and Delegated read the current person fields directly from the server.
