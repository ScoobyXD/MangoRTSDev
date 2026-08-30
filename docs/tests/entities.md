Last updated: 2026-08-29

# Entities Business Logic Laws

E1 - Entities is a first-class page at `/entities`, appears directly beneath Process Map in primary navigation, and shows the company's Entity Types, nested Entity Folders, Entities, Entity Field Types, and Entity Fields.

E2 - An Entity Type belongs to exactly one company, has a nonblank case-insensitively unique name within that company, and is the fixed type of every Entity created beneath it. A nonnull system key is a lowercase stable semantic identity and is unique within that company.

E3 - An Entity Folder belongs to exactly one Entity Type and company, may have one parent folder in that same Entity Type and company, and may nest to any depth without self-parenting or ancestry cycles.

E4 - An Entity Folder changes organization and creation defaults only. It never changes an Entity's company or Entity Type, grants access, or creates a business relationship.

E5 - An Entity may live at its Entity Type root or in exactly one folder belonging to that same Entity Type and company.

E6 - An Entity Field Type belongs either to an Entity Type root or to one folder under that Entity Type and defines a default field name, field kind, display position, stable optional system key, and validated configuration. Field Type names are case-insensitively unique within that exact template location, and nonnull system keys are unique across the complete Entity Type.

E7 - Creating an Entity resolves Entity Field Types from the Entity Type root through every ancestor folder to the selected folder. A deeper case-insensitively matching field name replaces the shallower definition, and new folder fields append in their stored position order.

E8 - Entity creation copies each resolved default into one Entity Field and retains the exact same-company `entity_field_type_id`. The copied name, kind, value, and position remain Entity-owned snapshots, while option configuration is always read live from that exact linked Entity Field Type and is never copied into the Entity Field.

E9 - Editing an Entity Field Type's option labels, option colors, option order, or default changes the current configuration seen by every still-linked Entity Field. Relabeling preserves each option's stable key, removing an option clears values that used that exact key, and additions append collision-safe new keys without reusing any key present when the edit began. Deleting an ordinary Entity Field Type or changing its kind clears its links without deleting copied Entity Fields; changing one Entity Field's kind clears only that field's link.

E10 - Every nonnull Entity Field Type link points to a template in the Entity's exact company and Entity Type, has the same field kind, and appears at most once in that Entity.

E11 - Ordinary Entity Fields may be renamed, reordered, retyped, or deleted. Required Action Item fields keep their exact template link, semantic key, label, and kind. Their editable values and display positions may change only through the permitted Entity commands; Source follows the stricter creation and lifecycle rules in E39 through E41.

E12 - Stored Entity Field Types and Entity Fields support exactly `text`, `number`, `date`, `boolean`, `choice`, `color`, `person`, and `resource`. A nonnull value must match its field kind, and changing an ordinary Entity Field's kind clears its value instead of performing an implicit conversion. `resource` is reserved internal storage for the protected Action Item Source system field and stores exactly canonical `resource_type` and UUID `resource_id`; ordinary template and field create or retype commands reject it.

E13 - `choice` and `color` configurations contain a nonempty ordered list of unique stable option keys and nonblank labels, each no longer than 200 characters. An option key starts with a lowercase letter and contains only lowercase letters, digits, and underscores. A color option also contains one lowercase six-digit hex color, a nonnull default must name a configured option, and a linked field accepts only a current configured option key.

E14 - A `person` value stores the exact UUID of a current member of the Entity's company, never a copied display name. Removing that company membership clears only fields assigned to that exact company member, and the UI resolves the current display label from the company user directory.

E15 - A `date` value is stored as `YYYY-MM-DD`; locale-specific month/day/year formatting is presentation only.

E16 - Moving an existing Entity between folders never reapplies templates or rewrites its Entity Fields.

E17 - Position stores manual sibling display order: folder position is scoped to one parent, Entity position is scoped to one folder or type root, and field position is scoped to one template location or Entity.

E18 - Deleting an ordinary Entity Field hard-deletes only that field. Deleting an ordinary Entity Field Type hard-deletes only that default, clears its exact links, and never deletes copied Entity Fields.

E19 - An Entity Folder may be deleted only when it has no child folders and no Entities; deleting it also deletes its own ordinary Entity Field Types. An ordinary Entity Type may be deleted only when it has no Entities; deleting it also deletes its folders and Entity Field Types.

E20 - Deleting an ordinary Entity hard-deletes its Entity Fields and exact `entity_relationships` rows. An Action Item cannot be hard-deleted while its archive behavior is deferred; a delete attempt changes nothing. Existing inline references retain their saved label but resolve to an unavailable Entity and never silently target another Entity.

E21 - Entities are company-wide and have no per-Entity permission, GVIC, placement, assignment, or policy rows. A signed-in company member may list, read, create, edit, move, and delete that company's ordinary Entities data but never another company's data.

E22 - Every supported non-email Mango editor may insert an Entity through Universal Picker `#` reference mode. Email compose, reply, and signature editors never retain inline Entity references: pasted, dropped, or preloaded Entity references become their saved label as plain text before any local or remote save, including close and navigation autosave, while other supported resource references remain unchanged. An Entity is never a legal `##` link target. Saving an Action Item reference in a Huddle Node or Huddle Logic Gate derives that exact resource's `entity_relationships` in the same transaction; other editor contexts create no Entity relationship.

E23 - The Universal Picker category order is Nodes, Processes, Projects, Entities, Emails. Entity search is company-scoped, bounded, cancellable, matches an Entity name or its Entity Type name, and returns only real Entities, never Entity Types or folders.

E24 - An inline Entity reference stores the fixed resource type `entity`, exact canonical Entity ID, and saved display label. Pointer, Enter, or Space activation reads that exact current Entity and opens its editable details. Deleting the reference changes editor content; in a Huddle Node or Huddle Logic Gate, removing its final reference also removes only that resource's exact Entity relationship.

E25 - Every company has exactly one required Entity Type named `Action Item` with system key `action_item`. Its identity, system key, and label are immutable, and it cannot be deleted independently of its company.

E26 - The Action Item Entity Type always has these required root templates: `person_in_charge` / `Person in charge` / `person`; `assigned_by` / `Assigned by` / `person`; `analysis_due_date` / `Analysis due date` / `date`; `completion_due_date` / `Completion due date` / `date`; `status` / `Status` / `choice`; `color` / `Color` / `color`; and `source` / `Source` / `resource`. Their deterministic identities, system keys, labels, kinds, and root placement are immutable, and those labels cannot be shadowed in an Action Item folder.

E27 - Every new Action Item uses the Entity's built-in name as its name, `body_json` as Details, created timestamp as its created date, and exact nullable `created_by_user_id` as creator audit metadata. Creation copies all seven required linked fields atomically, defaults Status to `in_progress`, and defaults Person in charge, Assigned by, both dates, Color, and Source to null.

E28 - The mandated Status configuration always contains exactly the keys `in_progress`, `pending`, and `done` and always defaults to `in_progress`. The mandated Color configuration always defaults to null and retains the keys `yellow` and `red`; it may add other color options or change current labels and hex colors without changing those required identities.

E29 - Action Item creation records the authenticated same-company actor in `created_by_user_id`; deleting that actor's company membership sets this audit pointer to null without changing the Action Item's name, Details, created timestamp, or Source field. Assigned by is separate editable business attribution, starts null, and is never inferred or backfilled from creator audit.

E30 - The retired Entity Fields label library, assignments, `/fields` page, Project field column/filter/grouping behavior, APIs, implementation, and old schema objects do not coexist with the current Entities system and have no compatibility path.

E31 - An ordinary inline Entity preview keeps the existing rich editor. An Action Item uses one compact editor anchored inside the activation point's owning modal layer. Details spans the top; beneath it the left column is Person in charge, Assigned by, Created date, Source and the right column is Color, Analysis due date, Completion due date, Status. Created date and Source are read-only, Created by remains hidden audit metadata, Status uses the accessible elevated choice listbox, and all edits keep 500 ms serialized autosave, close-time flush, and no Save button.

E32 - After the user releases a primary-pointer text selection, highlighting nonblank text in a supported editor exposes one split yellow/red Action Item action. Choosing a side atomically creates one real Action Item Entity with that color and the exact owning editor resource stored in its immutable Source field, then replaces the unchanged selection with one inline Entity reference to its exact ID; keyboard selection remains immediately usable.

E33 - Inline Action Item creation seeds Details from the selected text, defaults Status to In progress, records the authenticated creator, leaves Person in charge and Assigned by unset, and leaves the remaining editable required fields in the details dialog.

E34 - Yellow inline Action Item references pulse once every two seconds and red references once every second. Each uses the shared target-and-arrow icon, a fully filled color surface, black text, and no visible color-name suffix. A reduced-motion preference disables the pulse without changing color, identity, editing, or relationship behavior.

E35 - A Huddle Node or Huddle Logic Gate editor save atomically stores one exact typed `entity_relationships` row per distinct referenced Action Item Entity across that resource's live document set. Several references share that row, removing one reference keeps a sibling reference's row, and removing the final saved reference removes only that row; it never deletes the Entity or changes the immutable Action Item Source field.

E36 - A Huddle Process Action Item rollup unions its direct Huddle Logic Gate relationships with every relationship from its owned Huddle Nodes and deduplicates each Action Item once.

E37 - Direct Action Item creation from Entities remains allowed and leaves the required Source field value null. The forward storage cutover copies each exact legacy Source pair into the required linked field; every existing Action Item without one receives null, and no creator, relationship, label, or editor history is used to guess it.

E38 - Action Item Source is the required protected `source` / `Source` / `resource` Entity Field. Its nullable `value_jsonb` is either null or an object containing only one exact canonical `resource_type` and one exact UUID `resource_id`; supported types are exactly `node`, `logic_gate`, `project`, `huddle_node`, `huddle_logic_gate`, and `kpi`. It stores no copied label, anchor, document identity, or fallback identity.

E39 - A nonnull Source value validates the exact same-company live endpoint and the actor's current Edit access in the Action Item creation transaction. User and ordinary Entity Field APIs cannot edit Source after creation, and deleting an inline Action Item reference never changes it.

E40 - Source grants no access. Its read model resolves the current endpoint name and ID only for a currently authorized viewer; an unset, missing, inaccessible, recycled, or permanently deleted source returns a neutral unavailable state without hidden identity.

E41 - Recycling a source endpoint preserves the exact Source value while reads return the neutral unavailable projection; restoring that exact endpoint makes it resolvable again. Permanent endpoint deletion atomically clears matching Source values as lifecycle cleanup so no stale typed reference remains. Renaming a live endpoint changes the displayed Source name without rewriting the stored identity.
