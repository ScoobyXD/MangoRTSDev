import type { FilterContext, Layer, UpdateParameters } from "@deck.gl/core";
import { TileLayer, type _Tile2DHeader as TileHeader } from "@deck.gl/geo-layers";
import type { ProcessMapTileResponse } from "./processMapApi.js";

export type ProcessMapTileRenderState = {
  settledPixelsPerGridUnit: number;
  editedPlacementKeys: ReadonlySet<string>;
  editedTraceIDs: ReadonlySet<string>;
  selectedPlacementKey: string | null;
  selectedTraceID: string | null;
};

export type ProcessMapValidatedTile = {
  previous: ProcessMapTileResponse;
  current: ProcessMapTileResponse;
};

function changedMaskedIDs(
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
  previousSelection: string | null,
  nextSelection: string | null,
): Set<string> {
  const candidates = new Set([...previous, ...next]);
  if (previousSelection) candidates.add(previousSelection);
  if (nextSelection) candidates.add(nextSelection);
  const changed = new Set<string>();
  for (const id of candidates) {
    if ((previous.has(id) || previousSelection === id) !== (next.has(id) || nextSelection === id)) changed.add(id);
  }
  return changed;
}

function tileMaskChanged(tile: ProcessMapTileResponse, placements: ReadonlySet<string>, traces: ReadonlySet<string>): boolean {
  return (placements.size > 0 && tile.placements.some((placement) => (
    !placement.restricted && placements.has(`${placement.resource_type}:${placement.resource_id}`)
  ))) || (traces.size > 0 && tile.traces.some((trace) => traces.has(trace.resource_operational_relationship_id)));
}

export class ProcessMapProtectedTileLayer extends TileLayer<ProcessMapTileResponse, {
  protectedGeneration: number;
  readVersion: number;
  renderState: ProcessMapTileRenderState;
  validatedTiles: ReadonlyMap<string, ProcessMapValidatedTile> | null;
}> {
  static override layerName = "ProcessMapProtectedTileLayer";
  declare state: TileLayer<ProcessMapTileResponse>["state"] & { completedReadVersion?: number };

  override _onViewportLoad(): void {
    const selected = this.state.tileset?.selectedTiles;
    if (
      selected?.length && selected.every((tile) => tile.isLoaded && tile.content?.process_map_read_version === this.props.readVersion)
      && this.props.readVersion > (this.state.completedReadVersion ?? -1)
    ) {
      this.setState({ completedReadVersion: this.props.readVersion });
    }
    super._onViewportLoad();
  }

  override filterSubLayer(context: FilterContext): boolean {
    const { tile } = (context.layer as Layer<{ tile: TileHeader<ProcessMapTileResponse> }>).props;
    // Retain the last visible version while its replacement loads. Once a
    // current viewport completes, later pans must not resurrect older edits.
    if ((tile.content?.process_map_read_version ?? -1) < (this.state.completedReadVersion ?? -1)) return false;
    return super.filterSubLayer(context);
  }

  override updateState(params: UpdateParameters<this>): void {
    const previousTileset = this.state.tileset;
    const protectedChanged = params.oldProps.protectedGeneration !== params.props.protectedGeneration;
    const renderChanged = Boolean(params.changeFlags.updateTriggersChanged && params.changeFlags.updateTriggersChanged.renderSubLayers);
    if (previousTileset && protectedChanged) {
      previousTileset.finalize();
      this.setState({ tileset: null, isLoaded: false, completedReadVersion: undefined });
    }

    const selectiveReload = previousTileset && !protectedChanged && params.props.validatedTiles !== null
      && (params.changeFlags.dataChanged || params.oldProps.validatedTiles !== params.props.validatedTiles);
    if (selectiveReload) {
      for (const tile of previousTileset.tiles) {
        if (tile.isLoaded && tile.content?.process_map_read_version >= params.props.readVersion) continue;
        const validated = params.props.validatedTiles!.get(tile.id);
        if (
          tile.isLoaded && validated && tile.content === validated.previous
          && validated.previous.placements === validated.current.placements
          && validated.previous.traces === validated.current.traces
        ) {
          tile.content = validated.current;
        } else {
          tile.setNeedsReload();
        }
      }
      // Even an entirely clean viewport must report its newly certified version.
      this.setState({ isLoaded: false });
    }

    let retained: Map<TileHeader<ProcessMapTileResponse>, { content: ProcessMapTileResponse; layers: Layer[] }> | null = null;
    if (
      previousTileset && !protectedChanged && (renderChanged || selectiveReload)
      && params.oldProps.renderState.settledPixelsPerGridUnit === params.props.renderState.settledPixelsPerGridUnit
      && params.oldProps.tileSize === params.props.tileSize
      && params.oldProps.minZoom === params.props.minZoom
      && params.oldProps.maxZoom === params.props.maxZoom
      && params.oldProps.zoomOffset === params.props.zoomOffset
    ) {
      const previous = params.oldProps.renderState;
      const next = params.props.renderState;
      const placements = changedMaskedIDs(previous.editedPlacementKeys, next.editedPlacementKeys, previous.selectedPlacementKey, next.selectedPlacementKey);
      const traces = changedMaskedIDs(previous.editedTraceIDs, next.editedTraceIDs, previous.selectedTraceID, next.selectedTraceID);
      retained = new Map();
      for (const tile of previousTileset.tiles) {
        if (tile.content && tile.layers && !tileMaskChanged(tile.content, placements, traces)) {
          retained.set(tile, { content: tile.content, layers: tile.layers });
        }
      }
    }

    // Keep deck.gl's scheduler, cancellation, refinement, and version reloads.
    // Its broad render-trigger invalidation need not rebuild unaffected tiles.
    super.updateState(selectiveReload ? {
      ...params,
      changeFlags: { ...params.changeFlags, dataChanged: false },
    } : params);
    if (retained && previousTileset && this.state.tileset === previousTileset) {
      for (const tile of previousTileset.tiles) {
        const cached = retained.get(tile);
        tile.layers = cached && cached.content === tile.content ? cached.layers : null;
      }
    } else if (params.changeFlags.dataChanged && renderChanged) {
      // reloadAll retains old coverage; new LOD/masks must also apply to it now.
      this.state.tileset?.tiles.forEach((tile) => { tile.layers = null; });
    }
  }
}
