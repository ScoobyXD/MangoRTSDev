Last updated: 2026-08-27

# Entities Business Logic Laws

E1 - Entities is a first-class page at `/entities`, appears directly beneath Process Map in primary navigation, and shows the company's Entity Types, nested Entity Folders, Entities, Entity Field Types, and copied Entity Fields.

E2 - An Entity Type belongs to exactly one company, has a nonblank case-insensitively unique name within that company, and is the fixed type of every Entity created beneath it.

E3 - An Entity Folder belongs to exactly one Entity Type and company, may have one parent folder in that same Entity Type and company, and may nest to any depth without self-parenting or ancestry cycles.

E4 - An Entity Folder changes organization and creation defaults only. It never changes an Entity's company or Entity Type, grants access, or creates a business relationship.

E5 - An Entity may live at its Entity Type root or in exactly one folder belonging to that same Entity Type and company.

E6 - An Entity Field Type belongs either to an Entity Type root or to one folder under that Entity Type and defines only a default field name, field type, and display position for future Entities. Field Type names are case-insensitively unique within that exact template location.

E7 - Creating an Entity resolves Entity Field Types from the Entity Type root through every ancestor folder to the selected folder. A deeper case-insensitively matching field name replaces the shallower definition, and new folder fields append in their stored position order.

E8 - Entity creation copies the resolved defaults into independent Entity Fields. Later Entity Field Type creation, editing, movement, or deletion never changes an existing Entity Field.

E9 - Every Entity may create, rename, reorder, retype, or delete any of its own Entity Fields, including a field copied from a default Entity Field Type. Entity Field names are case-insensitively unique within that Entity.

E10 - Entity Field Types and Entity Fields support exactly `text`, `number`, `date`, and `boolean`. A nonblank Entity Field value must match its current field type, and changing an existing Entity Field's type clears its value instead of performing an implicit conversion.

E11 - Moving an existing Entity between folders never reapplies templates or rewrites its Entity Fields.

E12 - Position stores manual sibling display order: folder position is scoped to one parent, Entity position is scoped to one folder or type root, and field position is scoped to one template location or Entity.

E13 - Deleting an Entity Field hard-deletes only that field. Deleting an Entity Field Type hard-deletes only that default and never deletes copied Entity Fields.

E14 - An Entity Folder may be deleted only when it has no child folders and no Entities; deleting it also deletes its own Entity Field Types. An Entity Type may be deleted only when it has no Entities; deleting it also deletes its folders and Entity Field Types.

E15 - Deleting an Entity hard-deletes its Entity Fields. Existing inline references retain their saved label but resolve to an unavailable Entity and never silently target another Entity.

E16 - Entities are company-wide and have no per-Entity permission, GVIC, placement, assignment, or policy rows. A signed-in company member may list, read, create, edit, move, and delete that company's Entities data but never another company's data.

E17 - Every supported non-email Mango editor may insert an Entity through Universal Picker `#` reference mode. Email compose, reply, and signature editors never retain Entity reference chips: pasted, dropped, or preloaded Entity chips become their saved label as plain text while other supported resource references remain unchanged. An Entity is never a legal `##` link target and selecting one never mutates a relationship table.

E18 - The Universal Picker category order is Nodes, Processes, Projects, Entities, Emails. Entity search is company-scoped, bounded, cancellable, and returns only real Entities, never Entity Types or folders.

E19 - An inline Entity reference stores the fixed resource type `entity`, exact canonical Entity ID, and saved display label. Pointer, Enter, or Space activation reads that exact current Entity and opens its details; deleting the chip changes only editor content.

E20 - The retired Entity Fields label library, assignments, `/fields` page, Project field column/filter/grouping behavior, APIs, implementation, and old schema objects do not coexist with the new Entities system and have no compatibility path.
