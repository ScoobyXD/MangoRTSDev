import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveCompanyID } from "../../auth/currentCompany.js";
import { listCompanyUsers, type CompanyUser } from "../communications/communicationsApi.js";
import {
  createEntity,
  createEntityField,
  createEntityFieldType,
  createEntityFolder,
  createEntityType,
  deleteEntity,
  deleteEntityField,
  deleteEntityFieldType,
  deleteEntityFolder,
  deleteEntityType,
  getEntity,
  listEntityFieldTypes,
  listEntityFolders,
  listAllEntitiesForType,
  listEntityTypes,
  ENTITY_FIELD_TYPES,
  updateEntity,
  updateEntityField,
  updateEntityFieldType,
  updateEntityFolder,
  updateEntityType,
  type Entity,
  type EntityField,
  type EntityFieldDataType,
  type EntityFieldType,
  type EntityFolder,
  type EntitySummary,
  type EntityType,
} from "./entitiesApi.js";
import { buildChoiceFieldConfig, type FieldConfig, type FieldConfigOption } from "./entitiesChoiceConfig.js";
import { buildEntityTreeRows, entityFolderDescendantIDs } from "./entitiesPageModel.js";

export function EntitiesContent({ accent = "#0f766e" }: { accent?: string }) {
  const companyID = getActiveCompanyID();
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [folders, setFolders] = useState<EntityFolder[]>([]);
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [fieldTypes, setFieldTypes] = useState<EntityFieldType[]>([]);
  const [selectedTypeID, setSelectedTypeID] = useState("");
  const [selectedFolderID, setSelectedFolderID] = useState<string | null>(null);
  const [selectedEntityID, setSelectedEntityID] = useState("");
  const [entityDetail, setEntityDetail] = useState<Entity | null>(null);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [newFieldType, setNewFieldType] = useState<EntityFieldDataType>("text");
  const [newEntityFieldType, setNewEntityFieldType] = useState<EntityFieldDataType>("text");
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const catalogRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  const loadTypes = useCallback(async () => {
    if (!companyID) {
      setEntityTypes([]);
      setSelectedTypeID("");
      setLoadingTypes(false);
      return;
    }
    setLoadingTypes(true);
    try {
      const next = await listEntityTypes(companyID);
      setEntityTypes(next);
      setSelectedTypeID((current) => next.some((item) => item.entity_type_id === current) ? current : next[0]?.entity_type_id ?? "");
    } finally {
      setLoadingTypes(false);
    }
  }, [companyID]);

  const loadCatalog = useCallback(async (entityTypeID: string) => {
    const requestID = ++catalogRequestRef.current;
    if (!companyID || !entityTypeID) {
      setFolders([]);
      setEntities([]);
      setFieldTypes([]);
      setSelectedFolderID(null);
      setSelectedEntityID("");
      setEntityDetail(null);
      setLoadingCatalog(false);
      return;
    }
    setLoadingCatalog(true);
    try {
      const [nextFolders, nextEntities, nextFieldTypes] = await Promise.all([
        listEntityFolders(companyID, entityTypeID),
        listAllEntitiesForType(companyID, entityTypeID),
        listEntityFieldTypes(companyID, entityTypeID),
      ]);
      if (catalogRequestRef.current !== requestID) return;
      setFolders(nextFolders);
      setEntities(nextEntities);
      setFieldTypes(nextFieldTypes);
      setSelectedFolderID((current) => current && nextFolders.some((folder) => folder.entity_folder_id === current) ? current : null);
      setSelectedEntityID((current) => current && nextEntities.some((entity) => entity.entity_id === current) ? current : "");
    } catch (loadError) {
      if (catalogRequestRef.current !== requestID) return;
      setFolders([]);
      setEntities([]);
      setFieldTypes([]);
      setSelectedFolderID(null);
      setSelectedEntityID("");
      setEntityDetail(null);
      throw loadError;
    } finally {
      if (catalogRequestRef.current === requestID) setLoadingCatalog(false);
    }
  }, [companyID]);

  const loadDetail = useCallback(async (entityID: string, signal?: AbortSignal) => {
    const requestID = ++detailRequestRef.current;
    if (!companyID || !entityID) {
      setEntityDetail(null);
      setLoadingDetail(false);
      setDetailError("");
      return;
    }
    setEntityDetail(null);
    setLoadingDetail(true);
    setDetailError("");
    try {
      const detail = await getEntity(companyID, entityID, signal);
      if (detailRequestRef.current !== requestID || signal?.aborted) return;
      setEntityDetail(detail);
    } catch (loadError) {
      if (detailRequestRef.current !== requestID || signal?.aborted) return;
      setDetailError(errorMessage(loadError, "Failed to load entity"));
    } finally {
      if (detailRequestRef.current === requestID) setLoadingDetail(false);
    }
  }, [companyID]);

  useEffect(() => {
    setError("");
    void loadTypes().catch((loadError) => setError(errorMessage(loadError, "Failed to load entity types")));
  }, [loadTypes]);

  useEffect(() => {
    if (!companyID) {
      setCompanyUsers([]);
      return;
    }
    void listCompanyUsers(companyID).then(setCompanyUsers).catch(() => setCompanyUsers([]));
  }, [companyID]);

  useEffect(() => {
    setSelectedFolderID(null);
    setSelectedEntityID("");
    setEntityDetail(null);
    setError("");
    void loadCatalog(selectedTypeID).catch((loadError) => setError(errorMessage(loadError, "Failed to load entities")));
  }, [loadCatalog, selectedTypeID]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDetail(selectedEntityID, controller.signal);
    return () => controller.abort();
  }, [loadDetail, selectedEntityID]);

  const selectedType = entityTypes.find((item) => item.entity_type_id === selectedTypeID) ?? null;
  const selectedTypeIsSystem = Boolean(selectedType?.system_key?.trim());
  const selectedTypeIsActionItem = selectedType?.system_key === "action_item";
  const selectedFolder = folders.find((item) => item.entity_folder_id === selectedFolderID) ?? null;
  const treeRows = useMemo(() => buildEntityTreeRows(folders, entities), [folders, entities]);
  const folderOptions = useMemo(() => {
    const pathsByFolderID = new Map<string, string>();
    const options: Array<{ folder: EntityFolder; label: string }> = [];
    for (const row of treeRows) {
      if (row.kind !== "folder") continue;
      const parentPath = row.folder.parent_entity_folder_id
        ? pathsByFolderID.get(row.folder.parent_entity_folder_id)
        : "";
      const label = parentPath ? `${parentPath} / ${row.folder.name}` : row.folder.name;
      pathsByFolderID.set(row.folder.entity_folder_id, label);
      options.push({ folder: row.folder, label });
    }
    return options;
  }, [treeRows]);
  const selectedLocationFieldTypes = useMemo(() => fieldTypes
    .filter((item) => sameID(item.entity_folder_id, selectedFolderID))
    .sort(byPositionThenName), [fieldTypes, selectedFolderID]);
  const excludedFolderIDs = useMemo(() => selectedFolder
    ? new Set([selectedFolder.entity_folder_id, ...entityFolderDescendantIDs(folders, selectedFolder.entity_folder_id)])
    : new Set<string>(), [folders, selectedFolder]);

  const runMutation = async (action: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (mutationError) {
      setError(errorMessage(mutationError, fallback));
    } finally {
      setBusy(false);
    }
  };

  const selectType = (entityTypeID: string) => {
    if (busy) return;
    setSelectedTypeID(entityTypeID);
    setSelectedFolderID(null);
    setSelectedEntityID("");
  };

  const selectFolder = (entityFolderID: string | null) => {
    if (busy) return;
    setSelectedFolderID(entityFolderID);
    setSelectedEntityID("");
  };

  const selectEntity = (entity: EntitySummary) => {
    if (busy) return;
    setSelectedFolderID(entity.entity_folder_id?.trim() || null);
    setSelectedEntityID(entity.entity_id);
  };

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Company entities</div>
          <h1 style={titleStyle}>Entities</h1>
          <p style={subtitleStyle}>Create reusable structured information, organize it in folders, and define the fields each entity starts with.</p>
        </div>
        <div style={countPillStyle(accent)}>{entityTypes.length} {entityTypes.length === 1 ? "type" : "types"}</div>
      </header>

      {error ? <div role="alert" style={errorStyle}>{error}</div> : null}

      <div style={columnsStyle}>
        <section aria-label="Entity types" style={panelStyle}>
          <PanelHeading title="Entity types" detail="The fixed category for each entity." />
          <form
            style={inlineCreateStyle}
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const name = formText(form, "name");
              if (!name) return;
              void runMutation(async () => {
                const created = await createEntityType({ companyID, name });
                form.reset();
                await loadTypes();
                setSelectedTypeID(created.entity_type_id);
              }, "Failed to create entity type");
            }}
          >
            <input name="name" maxLength={100} placeholder="New type" aria-label="New entity type name" style={inputStyle} disabled={!companyID || busy} />
            <AddButton disabled={!companyID || busy} label="Add type" />
          </form>
          <div style={listStyle}>
            {loadingTypes ? <EmptyState>Loading types…</EmptyState> : entityTypes.length === 0 ? <EmptyState>No entity types yet.</EmptyState> : entityTypes.map((entityType) => (
              <button
                key={entityType.entity_type_id}
                type="button"
                disabled={busy}
                style={listButtonStyle(entityType.entity_type_id === selectedTypeID, accent)}
                onClick={() => selectType(entityType.entity_type_id)}
              >
                <span aria-hidden="true">▦</span>
                <span style={ellipsisStyle}>{entityType.name}</span>
              </button>
            ))}
          </div>
          {selectedType ? (
            <form
              key={selectedType.entity_type_id}
              style={editorFormStyle}
              onSubmit={(event) => {
                event.preventDefault();
                const name = formText(event.currentTarget, "name");
                if (!name) return;
                void runMutation(async () => {
                  await updateEntityType({ companyID, entityTypeID: selectedType.entity_type_id, name });
                  await loadTypes();
                }, "Failed to update entity type");
              }}
            >
              <label style={labelStyle}>Type name<input name="name" defaultValue={selectedType.name} maxLength={100} style={inputStyle} disabled={selectedTypeIsSystem} /></label>
              {selectedTypeIsSystem ? <span style={systemFieldNoteStyle}>Required company Entity Type</span> : null}
              <div style={actionsStyle}>
                <button type="submit" style={saveButtonStyle(accent)} disabled={busy || selectedTypeIsSystem}>Save</button>
                <button
                  type="button"
                  style={dangerButtonStyle}
                  disabled={busy || selectedTypeIsSystem}
                  onClick={() => {
                    if (!window.confirm(`Delete entity type “${selectedType.name}”? It must contain no entities.`)) return;
                    void runMutation(async () => {
                      await deleteEntityType(companyID, selectedType.entity_type_id);
                      setSelectedTypeID("");
                      await loadTypes();
                    }, "Failed to delete entity type");
                  }}
                >Delete</button>
              </div>
            </form>
          ) : null}
        </section>

        <section aria-label="Folders and entities" style={panelStyle}>
          <PanelHeading title={selectedType?.name ?? "Folders and entities"} detail="Folders only organize entities and creation defaults." />
          {selectedType ? (
            <>
              <div style={createGridStyle}>
                <form
                  style={inlineCreateStyle}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const name = formText(form, "name");
                    if (!name) return;
                    void runMutation(async () => {
                      const created = await createEntityFolder({ companyID, entityTypeID: selectedTypeID, parentEntityFolderID: selectedFolderID, name });
                      form.reset();
                      await loadCatalog(selectedTypeID);
                      setSelectedFolderID(created.entity_folder_id);
                    }, "Failed to create folder");
                  }}
                >
                  <input name="name" maxLength={100} placeholder={selectedFolder ? `Folder in ${selectedFolder.name}` : "Folder at type root"} aria-label="New entity folder name" style={inputStyle} disabled={busy} />
                  <AddButton disabled={busy} label="Add folder" />
                </form>
                <form
                  style={inlineCreateStyle}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const name = formText(form, "name");
                    if (!name) return;
                    void runMutation(async () => {
                      const created = await createEntity({
                        companyID,
                        entityTypeID: selectedTypeID,
                        entityFolderID: selectedFolderID,
                        name,
                        ...(selectedTypeIsActionItem ? { bodyJSON: entityBodyFromText(name) } : {}),
                      });
                      form.reset();
                      await loadCatalog(selectedTypeID);
                      setSelectedEntityID(created.entity_id);
                      setEntityDetail(created);
                    }, "Failed to create entity");
                  }}
                >
                  <input name="name" maxLength={200} placeholder={selectedFolder ? `Entity in ${selectedFolder.name}` : "Entity at type root"} aria-label="New entity name" style={inputStyle} disabled={busy} />
                  <AddButton disabled={busy} label="Add entity" />
                </form>
              </div>
              <button type="button" disabled={busy} style={rootButtonStyle(selectedFolderID === null && !selectedEntityID, accent)} onClick={() => selectFolder(null)}>⌂ Type root</button>
              <div style={treeStyle}>
                {loadingCatalog ? <EmptyState>Loading entities…</EmptyState> : treeRows.length === 0 ? <EmptyState>No folders or entities yet.</EmptyState> : treeRows.map((row) => row.kind === "folder" ? (
                  <button
                    key={`folder:${row.id}`}
                    type="button"
                    disabled={busy}
                    style={treeButtonStyle(row.depth, row.id === selectedFolderID && !selectedEntityID, accent)}
                    onClick={() => selectFolder(row.id)}
                  >
                    <span aria-hidden="true">▸</span><span aria-hidden="true">▰</span><span style={ellipsisStyle}>{row.folder.name}</span>
                  </button>
                ) : (
                  <button
                    key={`entity:${row.id}`}
                    type="button"
                    disabled={busy}
                    style={treeButtonStyle(row.depth, row.id === selectedEntityID, accent)}
                    onClick={() => selectEntity(row.entity)}
                  >
                    <span aria-hidden="true" /><span aria-hidden="true">◆</span><span style={ellipsisStyle}>{row.entity.name}</span>
                  </button>
                ))}
              </div>
            </>
          ) : <EmptyState>Create or select an entity type.</EmptyState>}
        </section>

        <section aria-label="Entity details" style={detailColumnStyle}>
          {selectedFolder ? (
            <section style={panelStyle}>
              <PanelHeading title="Folder" detail="Rename or move this folder." />
              <form
                key={selectedFolder.entity_folder_id}
                style={editorFormStyle}
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = formText(event.currentTarget, "name");
                  const parentEntityFolderID = formText(event.currentTarget, "parent_entity_folder_id") || null;
                  const position = formPosition(event.currentTarget, "position", selectedFolder.position);
                  if (!name) return;
                  void runMutation(async () => {
                    await updateEntityFolder({ companyID, entityFolderID: selectedFolder.entity_folder_id, name, parentEntityFolderID, position });
                    await loadCatalog(selectedTypeID);
                  }, "Failed to update folder");
                }}
              >
                <label style={labelStyle}>Name<input name="name" defaultValue={selectedFolder.name} maxLength={100} style={inputStyle} /></label>
                <label style={labelStyle}>Parent folder<select name="parent_entity_folder_id" defaultValue={selectedFolder.parent_entity_folder_id ?? ""} style={inputStyle}>
                  <option value="">Type root</option>
                  {folderOptions.filter(({ folder }) => !excludedFolderIDs.has(folder.entity_folder_id)).map(({ folder, label }) => <option key={folder.entity_folder_id} value={folder.entity_folder_id}>{label}</option>)}
                </select></label>
                <label style={labelStyle}>Position<input name="position" type="number" min={0} step={1} required defaultValue={selectedFolder.position} style={inputStyle} /></label>
                <div style={actionsStyle}>
                  <button type="submit" style={saveButtonStyle(accent)} disabled={busy}>Save</button>
                  <button
                    type="button"
                    style={dangerButtonStyle}
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Delete folder “${selectedFolder.name}”? It must be empty.`)) return;
                      void runMutation(async () => {
                        await deleteEntityFolder(companyID, selectedFolder.entity_folder_id);
                        setSelectedFolderID(null);
                        await loadCatalog(selectedTypeID);
                      }, "Failed to delete folder");
                    }}
                  >Delete</button>
                </div>
              </form>
            </section>
          ) : null}

          {selectedEntityID ? (
            <section style={panelStyle}>
              <PanelHeading title="Entity" detail={entityDetail?.entity_type_name ?? selectedType?.name ?? ""} />
              {loadingDetail ? <EmptyState>Loading entity…</EmptyState> : detailError ? (
                <div role="alert" style={detailErrorStyle}>
                  <span>{detailError}</span>
                  <button type="button" style={quietButtonStyle} onClick={() => void loadDetail(selectedEntityID)}>Retry</button>
                </div>
              ) : !entityDetail ? <EmptyState>Select an entity.</EmptyState> : (
                <>
                  <form
                    key={entityDetail.entity_id}
                    style={editorFormStyle}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = formText(event.currentTarget, "name");
                      const details = selectedTypeIsActionItem ? formValue(event.currentTarget, "details") : "";
                      const entityFolderID = formText(event.currentTarget, "entity_folder_id") || null;
                      const position = formPosition(event.currentTarget, "position", entityDetail.position);
                      if (!name) return;
                      void runMutation(async () => {
                        const saved = await updateEntity({
                          companyID,
                          entityID: entityDetail.entity_id,
                          name,
                          entityFolderID,
                          position,
                          ...(selectedTypeIsActionItem ? {
                            bodyJSON: entityBodyFromText(details),
                            baseRevision: entityDetail.revision,
                          } : {}),
                        });
                        setEntityDetail(saved);
                        setSelectedFolderID(saved.entity_folder_id?.trim() || null);
                        await loadCatalog(selectedTypeID);
                      }, "Failed to update entity");
                    }}
                  >
                    <label style={labelStyle}>Name<input name="name" defaultValue={entityDetail.name} maxLength={200} style={inputStyle} /></label>
                    {selectedTypeIsActionItem ? <label style={labelStyle}>Details<textarea name="details" defaultValue={entityBodyText(entityDetail.body_json)} rows={5} style={detailsInputStyle} /></label> : null}
                    <label style={labelStyle}>Created by<span style={readOnlyValueStyle}>{companyUserLabel(entityDetail.created_by_user_id, companyUsers)}</span></label>
                    <label style={labelStyle}>Created date<span style={readOnlyValueStyle}>{formatActionItemTimestamp(entityDetail.created_timestamp)}</span></label>
                    <label style={labelStyle}>Folder<select name="entity_folder_id" defaultValue={entityDetail.entity_folder_id ?? ""} style={inputStyle}>
                      <option value="">Type root</option>
                      {folderOptions.map(({ folder, label }) => <option key={folder.entity_folder_id} value={folder.entity_folder_id}>{label}</option>)}
                    </select></label>
                    <label style={labelStyle}>Position<input name="position" type="number" min={0} step={1} required defaultValue={entityDetail.position} style={inputStyle} /></label>
                    <div style={actionsStyle}>
                      <button type="submit" style={saveButtonStyle(accent)} disabled={busy}>Save</button>
                      <button
                        type="button"
                        style={dangerButtonStyle}
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Delete entity “${entityDetail.name}”?`)) return;
                          void runMutation(async () => {
                            await deleteEntity(companyID, entityDetail.entity_id);
                            setSelectedEntityID("");
                            setEntityDetail(null);
                            await loadCatalog(selectedTypeID);
                          }, "Failed to delete entity");
                        }}
                      >Delete</button>
                    </div>
                  </form>
                  <div style={dividerStyle} />
                  <PanelHeading title="Entity fields" detail="These fields belong only to this entity." />
                  <form
                    style={fieldCreateStyle}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const name = formText(form, "name");
                      if (!name) return;
                      void runMutation(async () => {
                        await createEntityField({ companyID, entityID: entityDetail.entity_id, name, fieldType: newEntityFieldType });
                        form.reset();
                        setNewEntityFieldType("text");
                        await loadDetail(entityDetail.entity_id);
                      }, "Failed to create entity field");
                    }}
                  >
                    <input name="name" maxLength={100} placeholder="New field" aria-label="New entity field name" style={inputStyle} />
                    <FieldTypeSelect value={newEntityFieldType} onChange={setNewEntityFieldType} fieldTypes={DIRECT_ENTITY_FIELD_TYPES} />
                    <AddButton disabled={busy} label="Add field" />
                  </form>
                  <div style={fieldListStyle}>
                    {entityDetail.entity_fields.length === 0 ? <EmptyState>No fields on this entity.</EmptyState> : entityDetail.entity_fields.slice().sort(byPositionThenName).map((field) => (
                      <EntityFieldEditor
                        key={field.entity_field_id}
                        field={field}
                        busy={busy}
                        accent={accent}
                        companyUsers={companyUsers}
                        onSave={(form) => runMutation(async () => {
                          const systemField = Boolean(field.system_key?.trim());
                          const nextType = systemField ? field.field_type : fieldDataType(formText(form, "field_type"));
                          await updateEntityField({
                            companyID,
                            entityID: entityDetail.entity_id,
                            entityFieldID: field.entity_field_id,
                            ...(systemField ? {} : { name: formText(form, "name"), fieldType: nextType }),
                            position: formPosition(form, "position", field.position),
                            ...(nextType === field.field_type && nextType !== "resource" ? { value: parseFieldValue(nextType, formText(form, "value")) } : {}),
                          });
                          await loadDetail(entityDetail.entity_id);
                        }, "Failed to update entity field")}
                        onDelete={() => runMutation(async () => {
                          await deleteEntityField(companyID, entityDetail.entity_id, field.entity_field_id);
                          await loadDetail(entityDetail.entity_id);
                        }, "Failed to delete entity field")}
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
          ) : null}

          {selectedType ? (
            <section style={panelStyle}>
              <PanelHeading
                title="Default fields"
                detail={selectedFolder ? `New entities in ${selectedFolder.name} inherit these after ancestor defaults.` : "New entities inherit these type defaults."}
              />
              <form
                style={fieldCreateStyle}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const name = formText(form, "name");
                  if (!name) return;
                  void runMutation(async () => {
                    await createEntityFieldType({
                      companyID,
                      entityTypeID: selectedTypeID,
                      entityFolderID: selectedFolderID,
                      name,
                      fieldType: newFieldType,
                      config: fieldConfigFromForm(form, newFieldType),
                    });
                    form.reset();
                    setNewFieldType("text");
                    await loadCatalog(selectedTypeID);
                  }, "Failed to create default field");
                }}
              >
                <input name="name" maxLength={100} placeholder="New default field" aria-label="New default field name" style={inputStyle} />
                <FieldTypeSelect value={newFieldType} onChange={setNewFieldType} />
                <AddButton disabled={busy} label="Add default" />
                <FieldConfigEditor fieldType={newFieldType} config={{}} />
              </form>
              <div style={fieldListStyle}>
                {selectedLocationFieldTypes.length === 0 ? <EmptyState>No defaults at this location.</EmptyState> : selectedLocationFieldTypes.map((field) => (
                  <form
                    key={field.entity_field_type_id}
                    style={fieldEditorStyle}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const systemField = Boolean(field.system_key?.trim());
                      void runMutation(async () => {
                        await updateEntityFieldType({
                          companyID,
                          entityFieldTypeID: field.entity_field_type_id,
                          ...(systemField ? {} : {
                            name: formText(form, "name"),
                            fieldType: fieldDataType(formText(form, "field_type")),
                            entityFolderID: formText(form, "entity_folder_id") || null,
                          }),
                          position: formPosition(form, "position", field.position),
                          config: fieldConfigFromForm(form, field.field_type, fieldConfig(field.config), field.system_key),
                        });
                        await loadCatalog(selectedTypeID);
                      }, "Failed to update default field");
                    }}
                  >
                    <input name="name" defaultValue={field.name} maxLength={100} aria-label={`Default field name ${field.name}`} style={inputStyle} disabled={Boolean(field.system_key?.trim())} />
                    <select name="field_type" defaultValue={field.field_type} aria-label={`Default field type ${field.name}`} style={inputStyle} disabled={Boolean(field.system_key?.trim())}>{fieldTypeOptions(field.system_key?.trim() ? [field.field_type] : USER_EDITABLE_ENTITY_FIELD_TYPES)}</select>
                    <select name="entity_folder_id" defaultValue={field.entity_folder_id ?? ""} aria-label={`Default field location ${field.name}`} style={inputStyle} disabled={Boolean(field.system_key?.trim())}>
                      <option value="">Type root</option>
                      {folderOptions.map(({ folder, label }) => <option key={folder.entity_folder_id} value={folder.entity_folder_id}>{label}</option>)}
                    </select>
                    <input name="position" type="number" min={0} step={1} required defaultValue={field.position} aria-label={`Default field position ${field.name}`} style={inputStyle} />
                    <button type="submit" style={quietButtonStyle} disabled={busy}>Save</button>
                    <button
                      type="button"
                      style={dangerButtonStyle}
                      disabled={busy || Boolean(field.system_key?.trim())}
                      onClick={() => void runMutation(async () => {
                        await deleteEntityFieldType(companyID, field.entity_field_type_id);
                        await loadCatalog(selectedTypeID);
                      }, "Failed to delete default field")}
                    >Delete</button>
                    <FieldConfigEditor fieldType={field.field_type} config={fieldConfig(field.config)} systemKey={field.system_key} />
                    {field.system_key?.trim() ? <span style={systemFieldNoteStyle}>Required field label and type</span> : null}
                  </form>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function PanelHeading({ title, detail }: { title: string; detail: string }) {
  return <div style={panelHeadingStyle}><h2 style={panelTitleStyle}>{title}</h2><span style={helperStyle}>{detail}</span></div>;
}

function AddButton({ disabled, label }: { disabled: boolean; label: string }) {
  return <button type="submit" disabled={disabled} style={addButtonStyle(disabled)} aria-label={label}>+</button>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div style={emptyStyle}>{children}</div>;
}

function FieldTypeSelect({ value, onChange, fieldTypes = USER_EDITABLE_ENTITY_FIELD_TYPES }: { value: EntityFieldDataType; onChange: (value: EntityFieldDataType) => void; fieldTypes?: readonly EntityFieldDataType[] }) {
  return <select value={value} aria-label="Field type" style={inputStyle} onChange={(event) => onChange(fieldDataType(event.currentTarget.value))}>{fieldTypeOptions(fieldTypes)}</select>;
}

function EntityFieldEditor({ field, busy, accent, companyUsers, onSave, onDelete }: {
  field: EntityField;
  busy: boolean;
  accent: string;
  companyUsers: CompanyUser[];
  onSave: (form: HTMLFormElement) => void;
  onDelete: () => void;
}) {
  const systemField = Boolean(field.system_key?.trim());
  const resourceField = field.field_type === "resource";
  return (
    <form key={`${field.entity_field_id}:${field.updated_timestamp}`} style={entityFieldEditorStyle} onSubmit={(event) => { event.preventDefault(); onSave(event.currentTarget); }}>
      <input name="name" defaultValue={field.name} maxLength={100} aria-label={`Entity field name ${field.name}`} style={inputStyle} disabled={systemField || resourceField} />
      <select name="field_type" defaultValue={field.field_type} aria-label={`Entity field type ${field.name}`} style={inputStyle} disabled={systemField || resourceField}>{fieldTypeOptions(systemField || resourceField ? [field.field_type] : DIRECT_ENTITY_FIELD_TYPES)}</select>
      <FieldValueInput field={field} companyUsers={companyUsers} />
      <input name="position" type="number" min={0} step={1} required defaultValue={field.position} aria-label={`Entity field position ${field.name}`} style={inputStyle} />
      <div style={actionsStyle}>
        <button type="submit" style={saveButtonStyle(accent)} disabled={busy}>Save</button>
        <button type="button" style={dangerButtonStyle} disabled={busy || systemField} onClick={onDelete}>Delete</button>
      </div>
      {systemField ? <span style={systemFieldNoteStyle}>Required field</span> : null}
    </form>
  );
}

function FieldValueInput({ field, companyUsers }: { field: EntityField; companyUsers: CompanyUser[] }) {
  if (field.field_type === "resource") {
    return <span data-entity-resource-field-value="true" aria-label={`Value for ${field.name}`} style={readOnlyValueStyle}>{field.value === null ? "Not set" : "Linked resource"}</span>;
  }
  if (field.field_type === "boolean") {
    return <select name="value" defaultValue={field.value === true ? "true" : field.value === false ? "false" : ""} aria-label={`Value for ${field.name}`} style={inputStyle}>
      <option value="">Not set</option><option value="true">True</option><option value="false">False</option>
    </select>;
  }
  if (field.field_type === "choice" || field.field_type === "color") {
    const options = fieldConfig(field.config).options ?? [];
    return <select name="value" defaultValue={field.value === null ? "" : String(field.value)} aria-label={`Value for ${field.name}`} style={inputStyle}>
      <option value="">{field.field_type === "color" ? "No color" : "Not set"}</option>
      {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select>;
  }
  if (field.field_type === "person") {
    return <select name="value" defaultValue={field.value === null ? "" : String(field.value)} aria-label={`Value for ${field.name}`} style={inputStyle}>
      <option value="">Unassigned</option>
      {companyUsers.map((user) => <option key={user.user_id} value={user.user_id}>{user.display_name?.trim() || user.email?.trim() || user.user_id}</option>)}
    </select>;
  }
  if (field.field_type === "date") {
    return <input
      name="value"
      type="text"
      inputMode="numeric"
      pattern="(?:0?[1-9]|1[0-2])/(?:0?[1-9]|[12][0-9]|3[01])/\d{4}"
      placeholder="MM/DD/YYYY"
      defaultValue={field.value === null ? "" : formatDateForEntityField(String(field.value))}
      aria-label={`Value for ${field.name}`}
      style={inputStyle}
    />;
  }
  return <input
    name="value"
    type={field.field_type === "number" ? "number" : "text"}
    step={field.field_type === "number" ? "any" : undefined}
    defaultValue={field.value === null ? "" : String(field.value)}
    aria-label={`Value for ${field.name}`}
    style={inputStyle}
  />;
}

const COLOR_FIELD_PRESETS: ReadonlyArray<FieldConfigOption> = [
  { key: "yellow", label: "Yellow", color: "#facc15" },
  { key: "red", label: "Red", color: "#ef4444" },
  { key: "orange", label: "Orange", color: "#f97316" },
  { key: "green", label: "Green", color: "#22c55e" },
  { key: "blue", label: "Blue", color: "#3b82f6" },
  { key: "purple", label: "Purple", color: "#a855f7" },
];

const USER_EDITABLE_ENTITY_FIELD_TYPES = ENTITY_FIELD_TYPES.filter((fieldType) => fieldType !== "resource");
const DIRECT_ENTITY_FIELD_TYPES = USER_EDITABLE_ENTITY_FIELD_TYPES.filter((fieldType) => fieldType !== "choice" && fieldType !== "color");

function FieldConfigEditor({ fieldType, config, systemKey = "" }: { fieldType: EntityFieldDataType; config: FieldConfig; systemKey?: string }) {
  if (fieldType === "choice") {
    const options = config.options ?? [];
    const requiredStatus = systemKey === "status";
    return <fieldset style={fieldConfigEditorStyle}>
      <legend style={fieldConfigLegendStyle}>Choices</legend>
      <span style={colorPresetGridStyle}>
        {options.map((option) => <label key={option.key} style={colorPresetStyle}>
          {requiredStatus ? <input type="hidden" name="config_choice" value={option.key} /> : null}
          <input
            name="config_choice"
            type="checkbox"
            value={option.key}
            defaultChecked
            disabled={requiredStatus}
            aria-label={`Use ${option.label}`}
          />
          <input
            name={`config_choice_label:${option.key}`}
            defaultValue={option.label}
            maxLength={100}
            aria-label={`${option.key} choice label`}
            style={colorLabelInputStyle}
          />
        </label>)}
      </span>
      {!requiredStatus ? <input
        name="config_choice_additions"
        placeholder={options.length === 0 ? "Pending, In progress, Done" : "Add choices, separated by commas"}
        aria-label="Add choice options"
        style={inputStyle}
      /> : null}
      <span style={helperStyle}>{requiredStatus
        ? "The three required status choices can be relabeled."
        : "Relabeling keeps existing values. Uncheck a choice to remove it; new choices are added at the end."}</span>
    </fieldset>;
  }
  if (fieldType === "color") {
    const configuredOptions = config.options ?? [];
    const selected = new Set(configuredOptions.map((option) => option.key));
    const isNew = !config.options;
    const options = [
      ...configuredOptions,
      ...COLOR_FIELD_PRESETS.filter((preset) => !selected.has(preset.key)),
    ];
    return <fieldset style={fieldConfigEditorStyle}>
      <legend style={fieldConfigLegendStyle}>Available colors</legend>
      <span style={colorPresetGridStyle}>
        {options.map((option) => {
          const required = systemKey === "color" && (option.key === "yellow" || option.key === "red");
          const checked = isNew ? option.key === "yellow" || option.key === "red" : selected.has(option.key);
          const color = validColorHex(option.color) ? option.color!.toLowerCase() : "#64748b";
          return <span key={option.key} style={colorPresetStyle}>
            {required ? <input type="hidden" name="config_color" value={option.key} /> : null}
            <input
              name="config_color"
              type="checkbox"
              value={option.key}
              defaultChecked={checked}
              disabled={required}
              aria-label={`Use ${option.label}`}
            />
            <input name={`config_color_hex:${option.key}`} type="color" defaultValue={color} aria-label={`${option.label} color`} style={colorPickerStyle} />
            <input name={`config_color_label:${option.key}`} defaultValue={option.label} maxLength={100} aria-label={`${option.key} color label`} style={colorLabelInputStyle} />
          </span>;
        })}
      </span>
      <span style={helperStyle}>No color is always available. Selected labels and colors update every linked Entity.</span>
    </fieldset>;
  }
  return null;
}

function fieldConfig(value: unknown): FieldConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as { default?: unknown; options?: unknown };
  const options = Array.isArray(raw.options) ? raw.options.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const option = candidate as { key?: unknown; label?: unknown; color?: unknown };
    if (typeof option.key !== "string" || typeof option.label !== "string") return [];
    return [{
      key: option.key,
      label: option.label,
      ...(typeof option.color === "string" ? { color: option.color } : {}),
    }];
  }) : undefined;
  return {
    ...(typeof raw.default === "string" || raw.default === null ? { default: raw.default } : {}),
    ...(options ? { options } : {}),
  };
}

function fieldConfigFromForm(form: HTMLFormElement, fieldType: EntityFieldDataType, current: FieldConfig = {}, systemKey = ""): FieldConfig {
  if (fieldType === "color") {
    const formData = new FormData(form);
    const seen = new Set<string>();
    const selectedKeys = formData.getAll("config_color").map(String).filter((key) => {
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const selected = new Set(selectedKeys);
    const options = selectedKeys.map((key) => {
      const label = String(formData.get(`config_color_label:${key}`) ?? "").trim();
      const color = String(formData.get(`config_color_hex:${key}`) ?? "").trim().toLowerCase();
      if (!label || !validColorHex(color)) throw new Error("Every selected color needs a label and valid color.");
      return { key, label, color };
    });
    if (options.length === 0) throw new Error("Select at least one available color.");
    const defaultKey = typeof current.default === "string" && selected.has(current.default) ? current.default : null;
    return { default: defaultKey, options };
  }
  if (fieldType === "choice") {
    const formData = new FormData(form);
    const existing = new Map((current.options ?? []).map((option) => [option.key, option]));
    const selectedChoices = formData.getAll("config_choice").map(String).flatMap((key) => {
      const option = existing.get(key);
      if (!option) return [];
      const label = String(formData.get(`config_choice_label:${key}`) ?? "").trim();
      return [{ key, label }];
    });
    const additions = String(formData.get("config_choice_additions") ?? "").split(",").map((label) => label.trim()).filter(Boolean);
    return buildChoiceFieldConfig(current, selectedChoices, additions, systemKey);
  }
  return {};
}

function formatDateForEntityField(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
}

function formatActionItemTimestamp(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
}

function companyUserLabel(userID: string | null | undefined, companyUsers: CompanyUser[]): string {
  const clean = userID?.trim() ?? "";
  if (!clean) return "Not recorded";
  const user = companyUsers.find((candidate) => candidate.user_id === clean);
  return user?.display_name?.trim() || user?.email?.trim() || clean;
}

function parseEntityFieldDate(value: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new Error("Use month/day/year for dates.");
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error("Use a valid month/day/year date.");
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function entityBodyFromText(value: string): object {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  return {
    format: "mango-tiptap-json",
    schema_version: 1,
    annotations: [],
    document: {
      type: "doc",
      content: lines.map((line) => ({
        type: "paragraph",
        ...(line ? { content: [{ type: "text", text: line }] } : {}),
      })),
    },
  };
}

function entityBodyText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const root = value as { document?: unknown };
  const document = root.document && typeof root.document === "object" ? root.document : value;
  const read = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const item = node as { type?: unknown; text?: unknown; content?: unknown };
    if (item.type === "text" && typeof item.text === "string") return item.text;
    if (!Array.isArray(item.content)) return "";
    const separator = item.type === "doc" ? "\n" : item.type === "paragraph" ? "" : "";
    return item.content.map(read).join(separator);
  };
  return read(document).trim();
}

function fieldTypeOptions(fieldTypes: readonly EntityFieldDataType[] = ENTITY_FIELD_TYPES) {
  return fieldTypes.map((fieldType) => <option key={fieldType} value={fieldType}>{fieldType}</option>);
}

function validColorHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function fieldDataType(value: string): EntityFieldDataType {
  return ENTITY_FIELD_TYPES.includes(value as EntityFieldDataType) ? value as EntityFieldDataType : "text";
}

function parseFieldValue(fieldType: EntityFieldDataType, value: string) {
  if (!value.trim()) return null;
  if (fieldType === "boolean") return value === "true";
  if (fieldType === "number") return Number(value);
  if (fieldType === "date") return parseEntityFieldDate(value);
  return value;
}

function formText(form: HTMLFormElement, name: string): string {
  return formValue(form, name).trim();
}

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "");
}

function formPosition(form: HTMLFormElement, name: string, fallback: number): number {
  const position = Number(formText(form, name));
  return Number.isSafeInteger(position) && position >= 0 ? position : fallback;
}

function sameID(value: string | null | undefined, expected: string | null): boolean {
  return (value?.trim() || null) === expected;
}

function byPositionThenName<T extends { position: number; name: string }>(left: T, right: T): number {
  return left.position - right.position || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

const pageStyle: React.CSSProperties = { width: "100%", height: "100%", minHeight: 0, overflow: "auto", boxSizing: "border-box", padding: "18px clamp(14px, 2vw, 28px) 28px", background: "#f4f7fb", color: "#0f172a" };
const headerStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, marginBottom: 14, padding: "18px 20px", border: "1px solid rgba(255,255,255,.9)", borderRadius: 16, background: "linear-gradient(145deg,#fff,#eef5f7)", boxShadow: "8px 8px 22px rgba(148,163,184,.18),-8px -8px 22px rgba(255,255,255,.9)" };
const eyebrowStyle: React.CSSProperties = { color: "#0f766e", fontSize: 11, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase" };
const titleStyle: React.CSSProperties = { margin: "3px 0 4px", fontSize: 27, lineHeight: 1.1, fontWeight: 950 };
const subtitleStyle: React.CSSProperties = { margin: 0, maxWidth: 700, color: "#64748b", fontSize: 13, fontWeight: 650, lineHeight: 1.5 };
const countPillStyle = (accent: string): React.CSSProperties => ({ border: `1px solid ${accent}33`, borderRadius: 999, background: `${accent}12`, color: accent, padding: "8px 11px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" });
const columnsStyle: React.CSSProperties = { minHeight: "calc(100vh - 190px)", display: "grid", gridTemplateColumns: "minmax(210px, .7fr) minmax(300px, 1fr) minmax(340px, 1.35fr)", alignItems: "start", gap: 14 };
const detailColumnStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 14 };
const panelStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 12, padding: 14, border: "1px solid rgba(255,255,255,.88)", borderRadius: 14, background: "rgba(255,255,255,.82)", boxShadow: "7px 7px 18px rgba(148,163,184,.16),-6px -6px 18px rgba(255,255,255,.86)" };
const panelHeadingStyle: React.CSSProperties = { display: "grid", gap: 3 };
const panelTitleStyle: React.CSSProperties = { margin: 0, fontSize: 15, fontWeight: 950, color: "#1e293b" };
const helperStyle: React.CSSProperties = { color: "#64748b", fontSize: 11, fontWeight: 650, lineHeight: 1.4 };
const inlineCreateStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0,1fr) 34px", gap: 7 };
const createGridStyle: React.CSSProperties = { display: "grid", gap: 8 };
const fieldCreateStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(100px,1fr) minmax(88px,.55fr) 34px", gap: 7 };
const inputStyle: React.CSSProperties = { width: "100%", minWidth: 0, minHeight: 34, boxSizing: "border-box", border: "1px solid rgba(148,163,184,.32)", borderRadius: 8, background: "rgba(255,255,255,.95)", color: "#0f172a", padding: "0 9px", font: "inherit", fontSize: 12, fontWeight: 700, outline: "none" };
const detailsInputStyle: React.CSSProperties = { ...inputStyle, minHeight: 94, resize: "vertical", padding: "8px 9px", lineHeight: 1.45 };
const readOnlyValueStyle: React.CSSProperties = { minHeight: 34, display: "flex", alignItems: "center", border: "1px solid rgba(148,163,184,.2)", borderRadius: 8, background: "rgba(241,245,249,.8)", color: "#475569", padding: "0 9px", fontSize: 12, fontWeight: 750, textTransform: "none", letterSpacing: 0 };
const addButtonStyle = (disabled: boolean): React.CSSProperties => ({ width: 34, height: 34, border: 0, borderRadius: 9, background: disabled ? "#cbd5e1" : "linear-gradient(135deg,#0f766e,#0d9488)", color: "#fff", font: "inherit", fontSize: 19, fontWeight: 900, cursor: disabled ? "default" : "pointer" });
const listStyle: React.CSSProperties = { minHeight: 80, display: "grid", alignContent: "start", gap: 5 };
const listButtonStyle = (active: boolean, accent: string): React.CSSProperties => ({ minWidth: 0, minHeight: 36, display: "grid", gridTemplateColumns: "18px minmax(0,1fr)", alignItems: "center", gap: 7, border: active ? `1px solid ${accent}40` : "1px solid transparent", borderRadius: 9, background: active ? `${accent}12` : "transparent", color: active ? accent : "#334155", padding: "0 9px", textAlign: "left", font: "inherit", fontSize: 12, fontWeight: 850, cursor: "pointer" });
const rootButtonStyle = (active: boolean, accent: string): React.CSSProperties => ({ ...listButtonStyle(active, accent), display: "block", width: "100%" });
const treeStyle: React.CSSProperties = { minHeight: 160, display: "grid", alignContent: "start", gap: 3, padding: "5px 0", borderTop: "1px solid rgba(148,163,184,.18)" };
const treeButtonStyle = (depth: number, active: boolean, accent: string): React.CSSProperties => ({ ...listButtonStyle(active, accent), width: "100%", gridTemplateColumns: "14px 16px minmax(0,1fr)", paddingLeft: 8 + Math.max(0, depth) * 20 });
const ellipsisStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const editorFormStyle: React.CSSProperties = { display: "grid", gap: 9, paddingTop: 10, borderTop: "1px solid rgba(148,163,184,.18)" };
const labelStyle: React.CSSProperties = { display: "grid", gap: 5, color: "#475569", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".04em" };
const actionsStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 7 };
const saveButtonStyle = (accent: string): React.CSSProperties => ({ minHeight: 30, border: 0, borderRadius: 8, background: accent, color: "#fff", padding: "0 11px", font: "inherit", fontSize: 11, fontWeight: 900, cursor: "pointer" });
const quietButtonStyle: React.CSSProperties = { minHeight: 30, border: "1px solid rgba(148,163,184,.28)", borderRadius: 8, background: "#fff", color: "#475569", padding: "0 10px", font: "inherit", fontSize: 11, fontWeight: 850, cursor: "pointer" };
const dangerButtonStyle: React.CSSProperties = { ...quietButtonStyle, color: "#b91c1c", borderColor: "rgba(239,68,68,.22)" };
const dividerStyle: React.CSSProperties = { height: 1, background: "rgba(148,163,184,.2)", margin: "2px 0" };
const fieldListStyle: React.CSSProperties = { display: "grid", gap: 8 };
const fieldEditorStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(90px,1fr) 92px minmax(100px,.8fr) 70px auto auto", alignItems: "center", gap: 6, padding: 8, border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "rgba(248,250,252,.75)" };
const entityFieldEditorStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(90px,1fr) 92px", gap: 7, padding: 9, border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "rgba(248,250,252,.75)" };
const fieldConfigEditorStyle: React.CSSProperties = { gridColumn: "1 / -1", minWidth: 0, display: "grid", gap: 6, margin: 0, padding: "7px 8px", border: "1px solid rgba(148,163,184,.18)", borderRadius: 8, color: "#475569", fontSize: 10, fontWeight: 850 };
const fieldConfigLegendStyle: React.CSSProperties = { padding: "0 4px", color: "#475569", fontSize: 10, fontWeight: 900 };
const colorPresetGridStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 7 };
const colorPresetStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, minHeight: 24, color: "#334155", fontSize: 10, fontWeight: 750 };
const colorPickerStyle: React.CSSProperties = { width: 26, height: 24, boxSizing: "border-box", border: "1px solid rgba(15,23,42,.14)", borderRadius: 5, background: "transparent", padding: 1, cursor: "pointer" };
const colorLabelInputStyle: React.CSSProperties = { ...inputStyle, width: 116, minHeight: 26, height: 26, padding: "0 6px", fontSize: 10 };
const systemFieldNoteStyle: React.CSSProperties = { gridColumn: "1 / -1", color: "#0f766e", fontSize: 10, fontWeight: 850 };
const emptyStyle: React.CSSProperties = { minHeight: 54, display: "grid", placeItems: "center", color: "#64748b", fontSize: 11, fontWeight: 750, textAlign: "center" };
const errorStyle: React.CSSProperties = { marginBottom: 12, padding: "9px 12px", border: "1px solid rgba(239,68,68,.24)", borderRadius: 9, background: "#fef2f2", color: "#b91c1c", fontSize: 12, fontWeight: 800 };
const detailErrorStyle: React.CSSProperties = { ...errorStyle, marginBottom: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
