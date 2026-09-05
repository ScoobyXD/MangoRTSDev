import { _flatten as flatten, type FilterContext, type Layer, type LayersList, type UpdateParameters } from "@deck.gl/core";
import { TileLayer, _Tileset2D as Tileset2D, type _Tile2DHeader as TileHeader } from "@deck.gl/geo-layers";
import type { ProcessMapTileResponse } from "./processMapApi.js";

export class ProcessMapTileset extends Tileset2D {
  // deck.gl 9.3.10 adds replacement bytes without removing the old size. Keep
  // this pinned-library correction here, alongside the existing tile adapter.
  private get cacheAccounting() {
    return this as unknown as { _cache: Map<string, TileHeader>; _cacheByteSize: number };
  }

  private reconcileCacheBytes(pendingAddition = 0): void {
    if (this.opts.maxCacheByteSize === null) return;
    let bytes = 0;
    for (const tile of this.cacheAccounting._cache.values()) bytes += tile.byteLength;
    this.cacheAccounting._cacheByteSize = bytes - pendingAddition;
  }

  override setOptions(options: Parameters<Tileset2D["setOptions"]>[0]): void {
    const { onTileLoad, onTileError, onTileUnload } = options;
    super.setOptions({
      ...options,
      onTileLoad: (tile) => {
        // The base callback adds this tile's bytes after our callback. Recount
        // resident content so reloads, failed/cancelled replacements and late
        // evicted requests cannot inflate the counter or revive coverage.
        this.reconcileCacheBytes(tile.byteLength);
        if (this.cacheAccounting._cache.get(tile.id) === tile) onTileLoad?.(tile);
      },
      onTileError: (error, tile) => {
        this.reconcileCacheBytes();
        if (this.cacheAccounting._cache.get(tile.id) === tile) onTileError?.(error, tile);
      },
      onTileUnload: (tile) => {
        tile.abort();
        this.reconcileCacheBytes();
        onTileUnload?.(tile);
      },
    });
  }

  override reloadAll(): void {
    // Retain old coverage and its accounting until replacement or normal
    // eviction. The base reloadAll silently deletes offscreen cache entries.
    for (const tile of this.tiles) tile.setNeedsReload();
  }

  override finalize(): void {
    super.finalize();
    this.cacheAccounting._cacheByteSize = 0;
  }

  override getTileIndices(options: Parameters<Tileset2D["getTileIndices"]>[0]) {
    this.reconcileCacheBytes();
    const indices = super.getTileIndices(options);
    if (indices.length < 2) return indices;
    const center = options.viewport.unproject([options.viewport.width / 2, options.viewport.height / 2]);
    const side = this.opts.tileSize / 2 ** indices[0].z;
    const x = center[0] / side - 0.5;
    const y = center[1] / side - 0.5;
    // Keep the existing scheduler and concurrency; enqueue the nearest tiles
    // first instead of revealing the viewport column by column.
    return indices.sort((left, right) => (
      (left.x - x) ** 2 + (left.y - y) ** 2 - (right.x - x) ** 2 - (right.y - y) ** 2
    ));
  }
}

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
  static override defaultProps = { TilesetClass: ProcessMapTileset };
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

  override renderLayers(): LayersList {
    const { visibleMinZoom, visibleMaxZoom, minZoom, extent } = this.props;
    const zoom = this.context.viewport.zoom;
    const hidden = (visibleMinZoom != null && zoom < visibleMinZoom)
      || (visibleMaxZoom != null && zoom > visibleMaxZoom)
      || (minZoom != null && !extent && zoom < minZoom);
    const layers: LayersList = [];
    // TileLayer's normal sublayer lifecycle, limited to visible coverage.
    // Offscreen payloads remain cached, but their GPU layers are released and
    // their new LOD/masks are built only if that coverage becomes visible.
    for (const tile of this.state.tileset?.tiles ?? []) {
      if (hidden || !tile.isVisible || (tile.content?.process_map_read_version ?? -1) < (this.state.completedReadVersion ?? -1)) {
        tile.layers = null;
        continue;
      }
      if (!tile.isLoaded && !tile.content) continue;
      const subLayerProps = this.getSubLayerPropsByTile(tile);
      if (!tile.layers) {
        tile.layers = (flatten(this.renderSubLayers({
          ...this.props,
          ...this.getSubLayerProps({ id: tile.id, updateTriggers: this.props.updateTriggers }),
          data: tile.content,
          _offset: 0,
          tile,
        }), Boolean) as Layer<{ tile?: TileHeader }>[]).map((layer) => layer.clone({ tile, ...subLayerProps }));
      } else if (subLayerProps && tile.layers[0] && (Object.keys(subLayerProps) as (keyof typeof subLayerProps)[]).some((key) => tile.layers![0].props[key] !== subLayerProps[key])) {
        tile.layers = tile.layers.map((layer) => layer.clone(subLayerProps));
      }
      layers.push(tile.layers);
    }
    return layers;
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
