// importerUI.tsx
//
// - This file was generated in part by an assortment of LLM models with some supervision near 2026-08-11.

import {
  type Ref,
  type MutableRefObject,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import "./importerUIResources/importToMango.css";
import "./importerUIResources/dotCursor.css";
import { InlineSvg } from "./importerUIResources/inlineSVG";
import { useImportSequencer, createImportCommands } from "./importerUIResources/importerUIAPI";
import type { ImportToMangoHandle, ImportToMangoProps, MangoSettings } from "./importerUIResources/types";

import { createMangoImporterProps } from "./importerConfig";

export type {
  MangoSource, MangoTextOption, MangoToggleOption, MangoOption, MangoSettings,
  BrowseItem, MangoError, ImportToMangoHandle, ImportToMangoProps,
} from "./importerUIResources/types";


// TODO: Verify usage and refactor into a more React-like pattern.
// A helper function
function mergeRefs<T>(...refs: readonly Ref<T>[]): (refSetParameter: T | null) => void {

  return (refSetParameter: T | null): void => {

    for(const ref of refs){

      // If the ref is a callback ref, call it with the passed in parameter.
      if(typeof ref === "function"){
        ref(refSetParameter);
      }

      // If the ref takes a value, set it's current value to the passed in parameter.
      else if(ref != null){

        // A workaround for React 18 to avoid rewriting later React structure.
        (ref as MutableRefObject<T | null>).current = refSetParameter;
      }
    }

  }
}

// ═══════════════════════════════════════════════════════════════════════
// THE COMPONENT — pure UI state and rendering only.
//
// The numbered call surface and the automated engine behind it both live in
// importerUIAPI.ts; this file just wires the sequencer + commands to a ref
// and owns the state a host never touches (which mode tab is selected,
// whether the settings sheet is open, the live values of the settings
// form) — plus the carton's pointer-tilt, a purely decorative effect with
// nothing to do with the import sequence. Scroll to the JSX below the
// component's logic for the actual HTML content.
// ═══════════════════════════════════════════════════════════════════════


// Preferred!
// This is the simplified importer that uses the default function behavior specified in the importer configuration.
export const SimpleMangoImporter = forwardRef<ImportToMangoHandle, null>(
  function SimpleMangoImporter(
    forwardedRef
  ) {

    const internalRef = useRef<ImportToMangoHandle | null>(null);
    const mangoProps = createMangoImporterProps(internalRef);

    // TODO: Verify merging of refs.
    const setRefs = mergeRefs(internalRef, forwardedRef);
    return (
      <ImportToMango {...mangoProps} ref={setRefs}/>
    );
  },
);


// This is the full-featured importer that accepts functions to call on UI events.
export const ImportToMango = forwardRef<ImportToMangoHandle, ImportToMangoProps>(
  function ImportToMango(
    {
      title = "Import to Mango",
      subtitle = "Import your data from Linear and ClickUp",
      sources,
      options,
      onFileSelected,
      onApiKeySubmit,
      onConfirm,
      onCancel,
      onRetry,
      onOpenWorkspace,
    },
    ref,
  ) {

    if(!sources || !options){
      throw new Error("Oops, either sources or options weren't provided at call time.");
    }

    const fileInputRef = useRef<HTMLInputElement>(null);
    const apiKeyRef = useRef<HTMLInputElement>(null);

    // The automatic-transition engine (timing gates, caption scheduling, the
    // progress-ring snap) lives in importerUIAPI.ts's useImportSequencer;
    // everything below this point is pure UI state plus the JSX that renders it.
    const seq = useImportSequencer(Object.keys(sources)[0] ?? "");
    const {
      rootRef, state, setState, source, doomed, failing, errored, setErrored, errorInfo,
      stageCaption, setStageCaption, foundCount, tally, rows, browseItems, lastProgress, dropGate,
    } = seq;

    const [mode, setMode] = useState<"csv" | "api">("csv");
    const [deskOpen, setDeskOpen] = useState(false);
    const [apiKeyVisible, setApiKeyVisible] = useState(false);
    const [apiKeyValue, setApiKeyValue] = useState("");

    const [settings, setSettings] = useState<MangoSettings>(() =>
      Object.fromEntries(options.map((o) => [o.id, o.default])),
    );

    const [browseOpen, setBrowseOpen] = useState(false);
    const [browseKind, setBrowseKind] = useState<"all" | "node" | "project">("all");
    const [browseSearch, setBrowseSearch] = useState("");

    // The public begin/found/scanned/... call surface a host importer drives.
    // Built as a `const` and referenced by that name internally (not `this`)
    // so it keeps working if a caller destructures it —
    // `const { item } = importRef.current` calling `item(x)` later would
    // otherwise lose its receiver and crash inside a cross-method call. See
    // importerUIAPI.ts's createImportCommands for the implementation.
    useImperativeHandle(
      ref,
      () => createImportCommands(seq, sources, settings, () => setDeskOpen(false)),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [sources, settings],
    );

    // Leaving a live stage (`confirm`/`importing`) for `closed` is the user
    // stopping an import in flight — the only signal a host gets that its
    // work should be abandoned. Tracked here instead of at every call site
    // that can reach `closed`, so it can't be missed from a new one later.
    const prevState = useRef(state);
    useEffect(() => {
      const was = prevState.current;
      prevState.current = state;
      if (state === "closed") {
        dropGate();
        if (was === "importing" || was === "confirm") onCancel?.();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state]);

    const close = useCallback(() => setState("closed"), [setState]);
    const askStop = useCallback(() => setState("confirm"), [setState]);
    const keepImporting = useCallback(() => setState("importing"), [setState]);
    const stopImporting = useCallback(() => setState("closed"), [setState]);

    const dial = useCallback(() => {
      if (mode === "api") {
        onApiKeySubmit?.(apiKeyValue.trim());
        return;
      }
      fileInputRef.current?.click();
    }, [mode, apiKeyValue, onApiKeySubmit]);

    const onFileInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) onFileSelected?.(file);
        e.target.value = "";
      },
      [onFileSelected],
    );

    // The carton turns to face the pointer while the panel is open — how far
    // it turns and that it only happens in the "open" state are both decided
    // in CSS off --uml-px/--uml-py; this just reports where the pointer is
    // and writes the two numbers directly (no React state, no re-render —
    // same reasoning as --flap-a
    // and setProgress in importerUIAPI.ts).
    const onStagePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      const r = e.currentTarget.getBoundingClientRect();
      if (!root || !r.width || !r.height) return;
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      const x = clamp(((e.clientX - r.left) / r.width) * 2 - 1);
      const y = clamp(((e.clientY - r.top) / r.height) * 2 - 1);
      root.style.setProperty("--uml-px", x.toFixed(3));
      root.style.setProperty("--uml-py", y.toFixed(3));
    }, [rootRef]);

    const onStagePointerLeave = useCallback(() => {
      const root = rootRef.current;
      if (!root) return;
      root.style.setProperty("--uml-px", "0");
      root.style.setProperty("--uml-py", "0");
    }, [rootRef]);

    const retry = useCallback(() => {
      setErrored(false);
      onRetry?.();
    }, [onRetry, setErrored]);

    const setOption = useCallback((id: string, value: string | boolean) => {
      setSettings((prev) => ({ ...prev, [id]: value }));
    }, []);

    const pickLabel =
      mode === "api" ? (apiKeyValue.trim() ? "Assess Connection" : "Enter API Key") : "Choose CSV File";

    const src = sources[source];

    const filteredBrowseItems = useMemo(() => {
      const q = browseSearch.trim().toLowerCase();
      return browseItems.filter((it) => {
        if (browseKind !== "all" && it.kind !== browseKind) return false;
        if (q && !it.name.toLowerCase().includes(q)) return false;
        return true;
      });
    }, [browseItems, browseKind, browseSearch]);

    // ═════════════════════════════════════════════════════════════════
    // THE HTML CONTENT — everything from here down is markup, not logic.
    // ═════════════════════════════════════════════════════════════════
    return (
      <section
        ref={rootRef}
        className="uml"
        data-state={state}
        data-source={source}
        data-uml-doomed={doomed ? "" : undefined}
        data-uml-fail={failing ? "" : undefined}
        data-uml-error={errored ? "" : undefined}
      >
        {/* Direct child of .uml, same as the CSS's :has(> .uml-browse__toggle:checked)
            requires — it doesn't matter where in the render tree this line sits,
            only that the input itself is a direct child of the root element. */}
        <input className="uml-state uml-browse__toggle" type="checkbox" id="uml-browse" checked={browseOpen} onChange={(e) => setBrowseOpen(e.target.checked)} />

        <div className="uml-card">
          <button type="button" className="uml-card__hit" aria-label="Open the import panel" onClick={() => setState("open")} />
          <span className="uml-ardial" aria-hidden="true">
            <span className="uml-ar"><i /><b /></span>
          </span>
          <div>
            <h3 className="uml-card__title">{title}</h3>
            <p className="uml-card__sub">{subtitle}</p>
          </div>
        </div>

        <button type="button" className="uml-scrim uml-scrim--direct" aria-label="Close" onClick={close} />
        <button type="button" className="uml-scrim uml-scrim--guard" aria-label="Stop this import" onClick={askStop} />

        <div className="uml-panel dot-cursor" role="dialog" aria-modal="true" aria-label={title}>
          <div className="uml-head-row">
            <header className="uml-head">
              <span className="uml-ardial" aria-hidden="true">
                <span className="uml-ar"><i /><b /></span>
              </span>
              <div>
                <h2 className="uml-head__title">{title}</h2>
                <p className="uml-head__sub">{subtitle}</p>
              </div>
            </header>
            <button type="button" className="uml-x uml-x--direct dot-cursor" aria-label="Close" onClick={close} />
            <button type="button" className="uml-x uml-x--guard dot-cursor" aria-label="Stop this import" onClick={askStop} />
          </div>

          <div className="uml-body">
            <aside className="uml-guide-col">
              <div className="uml-slot">
                <div className="uml-tile uml-tile--time">
                  <div className="uml-time">
                    <span className="uml-disc" aria-hidden="true"><span className="uml-clock" /></span>
                    <span className="uml-time__text">
                      <span className="uml-time__value">5 to 30+ Minutes</span>
                      <span className="uml-time__label">Based on Data Size</span>
                    </span>
                  </div>
                </div>

                <div className="uml-tile uml-tile--ring">
                  <div className="uml-ring" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={lastProgress.current} aria-label="Import progress">
                    <div className="uml-ring__track" />
                    <div className="uml-ring__arc" />
                    <div className="uml-ring__cap uml-ring__cap--start" />
                    <div className="uml-ring__cap uml-ring__cap--end" />
                    <div className="uml-ring__pct" aria-hidden="true" />
                  </div>
                  <p className="uml-ring__label" aria-live="polite">
                    <b className="uml-ring__stage">{stageCaption}</b>
                    <span className="uml-ring__sub uml-ring__sub--run">Import in Progress</span>
                    <span className="uml-ring__sub uml-ring__sub--done">Workspace Planted</span>
                  </p>
                  <div className="uml-tally">
                    <label className="uml-tally__cell dot-cursor" htmlFor="uml-browse">
                      <b className="uml-tally__items">{tally.nodes.toLocaleString()}</b><span>Nodes</span>
                    </label>
                    <label className="uml-tally__cell dot-cursor" htmlFor="uml-browse">
                      <b className="uml-tally__projects">{tally.projects.toLocaleString()}</b><span>Projects</span>
                    </label>
                    <p className="uml-skipped">
                      <span className="uml-skipped__label">Skipped</span>
                      <b className="uml-skipped__value uml-tally__gates">{tally.skipped.toLocaleString()}</b>
                    </p>
                  </div>
                </div>
              </div>

              <div className="uml-tile uml-tile--found">
                <b className="uml-found__value">{foundCount.toLocaleString()}</b>
                <span className="uml-found__label">Items Identified</span>
              </div>

              <div className="uml-guide">
                <ol className="uml-steps">
                  <li>
                    <b>Export CSV or Obtain Key</b>
                    <span>Review your export options from your Linear or ClickUp workspace settings.</span>
                  </li>
                  <li>
                    <b>Drop it in the Box</b>
                    <span>Drag your CSV export into the box or enter your API Key.</span>
                  </li>
                  <li>
                    <b>Grow your Workspace</b>
                    <span>Imported data is automatically converted to Mango&rsquo;s intuitive formats.</span>
                  </li>
                </ol>
              </div>

              <p className="uml-warn">
                <span className="uml-warn__icon" aria-hidden="true" />
                <span>Imports are processed by this window, so closing or minimizing will interrupt your upload.</span>
              </p>

              <a className="uml-cta" href="#" onClick={onOpenWorkspace}>
                <span>Take Me To My Mango Workspace</span>
                <span className="uml-ardial" aria-hidden="true"><span className="uml-ar"><i /><b /></span></span>
              </a>
            </aside>

            <section className="uml-drop">
              <div className="uml-stage" onPointerMove={onStagePointerMove} onPointerLeave={onStagePointerLeave}>
                <input
                  ref={fileInputRef}
                  className="uml-drop__input"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onFileInputChange}
                />

                {/* These four secondary toggles (mode, desk sheet, browse panel,
                    browse-kind tabs) stay real radio/checkbox inputs, controlled by
                    React instead of left uncontrolled — importToMango.css drives
                    them purely off :checked/:has(), with no data-state equivalent
                    the way the main 7-state sequence has. Swapping them for buttons
                    would need CSS changes; this doesn't. */}
                <input className="uml-state uml-mode" type="radio" name="uml-mode" id="uml-mode-csv" checked={mode === "csv"} onChange={() => setMode("csv")} />
                <input className="uml-state uml-mode uml-mode--api" type="radio" name="uml-mode" id="uml-mode-api" checked={mode === "api"} onChange={() => setMode("api")} />

                <div className="uml-modes" role="tablist" aria-label="Upload method">
                  <span className="uml-modes__thumb" aria-hidden="true" />
                  <label className="uml-modes__opt dot-cursor" htmlFor="uml-mode-csv">CSV File</label>
                  <label className="uml-modes__opt dot-cursor" htmlFor="uml-mode-api">API Key</label>
                </div>

                <label className="uml-drop__api" htmlFor="uml-api" aria-label="Enter an API key" />
                <input className="uml-state uml-desk" type="radio" name="uml-desk" id="uml-desk-none" checked={!deskOpen} onChange={() => setDeskOpen(false)} />
                <input className="uml-state uml-desk uml-desk--cfg" type="radio" name="uml-desk" id="uml-desk-cfg" checked={deskOpen} onChange={() => setDeskOpen(true)} />
                <label className="uml-cog dot-cursor" htmlFor="uml-desk-cfg">
                  <span className="uml-sr">Import configuration</span>
                  <InlineSvg src="./importerUIResources/vectors/growthTree.svg" className="uml-cog__svg" />
                </label>

                <div className="uml-scene" aria-hidden="true">
                  <span className="uml-blobs"><i /><i /><i /><i /></span>
                  <div className="uml-plant" />

                  <div className="uml-names">
                    <ul className="uml-names__track">
                      {rows.length > 0 &&
                        [...rows, ...rows].map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>

                  <div className="uml-belt">
                    <div className="uml-belt__plates" />
                    <div className="uml-belt__rollers" />
                    <div className="uml-belt__return" />
                  </div>

                  <div className="uml-scanner">
                    <div className="uml-scanner__frame" />
                    <i className="uml-scanner__port uml-scanner__port--in" />
                    <i className="uml-scanner__port uml-scanner__port--out" />
                  </div>

                  <div className="uml-beam" aria-hidden="true"><i className="uml-beam__bar" /></div>

                  <p className="uml-done-banner">
                    <span className="uml-tick" aria-hidden="true" />
                    Workspace Imported
                  </p>

                  <div className="uml-box">
                    <div className="uml-box__scene">
                      <div className="uml-box__wall uml-box__wall--back" />
                      <div className="uml-box__wall uml-box__wall--left" />
                      <div className="uml-box__wall uml-box__wall--right">
                        <span className="uml-box__mark" aria-hidden="true"><i /><i /></span>
                      </div>
                      <div className="uml-box__floor" />

                      <div className="uml-box__xray">
                        <i /><i /><i />
                        <b className="uml-box__xray-q" aria-hidden="true">?</b>
                      </div>

                      <div className="uml-box__wall uml-box__wall--front">
                        <span className="uml-box__label">
                          <span className="uml-box__glyph">{src?.mark}</span><b>{src?.label ?? source}</b>
                        </span>
                      </div>

                      <div className="uml-box__flap uml-box__flap--left">
                        <div className="uml-box__flap-face uml-box__flap-face--out" />
                        <div className="uml-box__flap-face uml-box__flap-face--in" />
                      </div>
                      <div className="uml-box__flap uml-box__flap--right">
                        <div className="uml-box__flap-face uml-box__flap-face--out" />
                        <div className="uml-box__flap-face uml-box__flap-face--in" />
                      </div>
                      <div className="uml-box__flap uml-box__flap--back">
                        <div className="uml-box__flap-face uml-box__flap-face--out" />
                        <div className="uml-box__flap-face uml-box__flap-face--in" />
                      </div>
                      <div className="uml-box__flap uml-box__flap--front">
                        <div className="uml-box__flap-face uml-box__flap-face--out" />
                        <div className="uml-box__flap-face uml-box__flap-face--in" />
                      </div>

                      <div className="uml-box__lid">
                        <i className="uml-tape uml-tape--lid-a" />
                        <i className="uml-tape uml-tape--lid-b" />
                      </div>
                      <i className="uml-tape uml-tape--left" />
                      <i className="uml-tape uml-tape--right" />
                      <i className="uml-tape uml-tape--back" />
                    </div>

                    <InlineSvg src="./importerUIResources/vectors/growthTree.svg" className="uml-tree" />
                  </div>
                </div>

                <div className="uml-sheet" role="group" aria-label="Import settings">
                  <div className="uml-sheet__head">
                    <h3 className="uml-sheet__title">
                      <span className="uml-sheet__title--edit">Import Settings</span>
                      <span className="uml-sheet__title--ready">Ready to Import</span>
                    </h3>
                    <p className="uml-sheet__sub">
                      <b className="uml-sheet__src">{src?.label ?? source}</b> · Scanned and Mapped
                    </p>
                  </div>

                  <div className="uml-sheet__body">
                    {options.map((o) =>
                      o.type === "text" ? (
                        <div className="uml-field" key={o.id}>
                          <label className="uml-field__label" htmlFor={`uml-o-${o.id}`}>{o.title}</label>
                          <input
                            className="uml-field__input"
                            id={`uml-o-${o.id}`}
                            type="text"
                            placeholder={o.placeholder ?? ""}
                            value={(settings[o.id] as string) ?? ""}
                            onChange={(e) => setOption(o.id, e.target.value)}
                          />
                          {o.description && <p className="uml-field__hint">{o.description}</p>}
                        </div>
                      ) : (
                        <label className="uml-opt" key={o.id}>
                          <input
                            type="checkbox"
                            checked={Boolean(settings[o.id])}
                            onChange={(e) => setOption(o.id, e.target.checked)}
                          />
                          <span className="uml-opt__box" aria-hidden="true" />
                          <span className="uml-opt__text">
                            <b>{o.title}</b>
                            {o.description && <span className="uml-opt__desc">{o.description}</span>}
                          </span>
                        </label>
                      ),
                    )}
                  </div>

                  <label className="uml-sheet__done dot-cursor" htmlFor="uml-desk-none">Done</label>
                  <button
                    type="button"
                    className="uml-sheet__go dot-cursor"
                    onClick={() => {
                      setState("importing");
                      setStageCaption("Growing Your Workspace");
                      onConfirm?.(settings);
                    }}
                  >
                    <span>Start Import</span>
                    <span className="uml-ardial" aria-hidden="true"><span className="uml-ar"><i /><b /></span></span>
                  </button>
                </div>

                <div className="uml-pick">
                  <div className="uml-pick__bar">
                    <span className="uml-pick__label">{pickLabel}</span>
                    <span className="uml-pick__field">
                      <input
                        ref={apiKeyRef}
                        className="uml-pick__input"
                        id="uml-api"
                        type={apiKeyVisible ? "text" : "password"}
                        autoComplete="off"
                        spellCheck={false}
                        aria-label="API key"
                        placeholder="Paste your API key"
                        value={apiKeyValue}
                        onChange={(e) => setApiKeyValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            dial();
                          }
                        }}
                      />
                      <button
                        className="uml-pick__eye dot-cursor"
                        type="button"
                        aria-label={apiKeyVisible ? "Hide API key" : "Show API key"}
                        aria-pressed={apiKeyVisible}
                        onClick={() => {
                          setApiKeyVisible((v) => !v);
                          apiKeyRef.current?.focus();
                        }}
                      >
                        <span className="uml-eye" aria-hidden="true"><i /></span>
                      </button>
                    </span>

                    <button
                      className="uml-pick__dial dot-cursor"
                      type="button"
                      aria-label={mode === "api" ? "Assess Connection" : "Choose a CSV file"}
                      onClick={dial}
                    >
                      <span className="uml-ar" aria-hidden="true"><i /><b /></span>
                    </button>
                  </div>
                </div>

                <div className="uml-error" role="alertdialog" aria-labelledby="uml-err-t">
                  <span className="uml-error__mark" aria-hidden="true" />
                  <b className="uml-error__title" id="uml-err-t">{errorInfo.title}</b>
                  <p className="uml-error__detail">{errorInfo.detail}</p>
                  <button className="uml-error__go dot-cursor" type="button" onClick={retry}>
                    <span>Try Again</span>
                    <span className="uml-ardial" aria-hidden="true"><span className="uml-ar"><i /><b /></span></span>
                  </button>
                </div>
              </div>

              <p className="uml-drop__hint">Or drag a <b>.csv</b> anywhere in this panel</p>

              <ol className="uml-stepper">
                <li>Choose</li>
                <li>Unpack &amp; Scan</li>
                <li>Import</li>
                <li>Done</li>
              </ol>
            </section>
          </div>

          <div className="uml-browse" role="region" aria-label="Imported items" data-empty={browseItems.length > 0 && filteredBrowseItems.length === 0}>
            <div className="uml-browse__bar">
              <h3 className="uml-browse__title">Imported Items</h3>
              <label className="uml-browse__close dot-cursor" htmlFor="uml-browse">
                <span className="uml-sr">Close</span>
              </label>
            </div>

            <div className="uml-browse__search">
              <span className="uml-browse__glass" aria-hidden="true" />
              <input
                className="uml-browse__input"
                type="search"
                placeholder="Search nodes and projects…"
                aria-label="Search imported items"
                value={browseSearch}
                onChange={(e) => setBrowseSearch(e.target.value)}
              />
            </div>

            <div className="uml-browse__tabs" role="group" aria-label="Filter by kind">
              <input className="uml-browse__radio" type="radio" name="uml-browse-kind" id="uml-bk-all" checked={browseKind === "all"} onChange={() => setBrowseKind("all")} />
              <label className="uml-browse__tab dot-cursor" htmlFor="uml-bk-all">All</label>
              <input className="uml-browse__radio" type="radio" name="uml-browse-kind" id="uml-bk-node" checked={browseKind === "node"} onChange={() => setBrowseKind("node")} />
              <label className="uml-browse__tab dot-cursor" htmlFor="uml-bk-node">Nodes</label>
              <input className="uml-browse__radio" type="radio" name="uml-browse-kind" id="uml-bk-proj" checked={browseKind === "project"} onChange={() => setBrowseKind("project")} />
              <label className="uml-browse__tab dot-cursor" htmlFor="uml-bk-proj">Projects</label>
            </div>

            {/* Kind (All/Nodes/Projects) is filtered purely by CSS reading
                data-kind, same as the tabs above it — only the search box's
                hidden flag is decided here, since reading an input's value is
                the one filter CSS genuinely cannot do. */}
            <ul className="uml-browse__list">
              {browseItems.map((it, i) => {
                const q = browseSearch.trim().toLowerCase();
                const matchesSearch = !q || it.name.toLowerCase().includes(q);
                return (
                  <li key={i} className="uml-browse__item" data-kind={it.kind} hidden={!matchesSearch}>
                    <span className="uml-browse__dot" />
                    <span className="uml-browse__name">{it.name}</span>
                    <span className="uml-browse__kind">{it.kind}</span>
                  </li>
                );
              })}
            </ul>
            <p className="uml-browse__empty">Nothing matches that search.</p>
          </div>
        </div>

        <span className="uml-sprinkles" aria-hidden="true">
          {SPRINKLES.map((s, i) => (
            <i key={i} style={{ "--a": s.a, "--d": s.d, "--t": s.t, "--c": s.c } as React.CSSProperties} />
          ))}
        </span>

        <div className="uml-confirm dot-cursor" role="alertdialog" aria-modal="true" aria-label="Stop this import?">
          <button type="button" className="uml-confirm__scrim" aria-label="Keep Importing" onClick={keepImporting} />
          <div className="uml-confirm__panel">
            <h2 className="uml-confirm__title">Stop This Import?</h2>
            <p className="uml-confirm__copy">
              Anything you've aready uploaded will stay in Mango,
              but you can an retry the import at any time by coming back here.
            </p>
            <div className="uml-confirm__actions">
              <button type="button" className="uml-btn uml-btn--ghost" onClick={stopImporting}>Stop Importing</button>
              <button type="button" className="uml-btn uml-btn--solid" onClick={keepImporting}>Keep Importing</button>
            </div>
          </div>
        </div>
      </section>
    );
  },
);

const SPRINKLES = [
  { a: "-74deg", d: "64px", t: "40ms", c: "#e0231f" },
  { a: "-52deg", d: "78px", t: "90ms", c: "#1449cf" },
  { a: "-30deg", d: "68px", t: "20ms", c: "#f2c000" },
  { a: "-10deg", d: "84px", t: "120ms", c: "#e0231f" },
  { a: "10deg", d: "66px", t: "60ms", c: "#1449cf" },
  { a: "30deg", d: "80px", t: "100ms", c: "#f2c000" },
  { a: "52deg", d: "62px", t: "30ms", c: "#cf5c07" },
  { a: "74deg", d: "74px", t: "140ms", c: "#1449cf" },
  { a: "-96deg", d: "54px", t: "160ms", c: "#f2c000" },
  { a: "96deg", d: "56px", t: "75ms", c: "#e0231f" },
];
