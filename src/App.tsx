import { type ReactNode, useEffect, useRef, useState } from "react";
import { ErrorBoundary, SceneError } from "./ErrorBoundary";
import { type CameraState, SceneViewport } from "./SpaceScene";
import { LOCAL_SYSTEM_SCENE_UNITS_PER_METER } from "./localSystemProjection";
import { selectRenderQuality, type RenderQuality } from "./renderQuality";
import type { SystemResource, UniverseIndex } from "./universe/generateUniverse";
import { selectRoutePreview } from "./universe/routePreview";
import { ACCELERATION_DURATION, DECELERATION_DURATION, type TravelFrame, type TravelPhase } from "./travelCoordinates";
import { projectInterstellarRouteDirection } from "./interstellarProjection";

const INITIAL_CAMERA: CameraState = { azimuth: 0.55, elevation: 0.25, distance: 12 };
type PreviewSystem = { id: number; name: string };
type PreviewState = { gateId: number; systems: PreviewSystem[]; edges: [number, number][]; leaving: boolean } | null;
type TravelState = (TravelFrame & { gateId: number }) | null;

export default function App(): ReactNode {
  const snapshotTime = new URLSearchParams(window.location.search).get("snapshotTime");
  const [webgl, setWebgl] = useState<"checking" | "ready" | "unavailable">("checking");
  const [universeIndex, setUniverseIndex] = useState<UniverseIndex | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [camera, setCamera] = useState(INITIAL_CAMERA);
  const [system, setSystem] = useState<SystemResource | null>(null);
  const [activeSystemId, setActiveSystemId] = useState<number | null>(null);
  const [activeGateId, setActiveGateId] = useState<number | null>(null);
  const [displayedPreview, setDisplayedPreview] = useState<PreviewState>(null);
  const [travelError, setTravelError] = useState<string | null>(null);
  const [failedGateId, setFailedGateId] = useState<number | null>(null);
  const [travel, setTravel] = useState<TravelState>(null);
  const [loadingDestination, setLoadingDestination] = useState(false);
  const [renderPreferences, setRenderPreferences] = useState(readRenderPreferences);
  const travelController = useRef<AbortController | null>(null);
  const resourceCache = useRef(new Map<number, SystemResource>());
  const currentSystemId = activeSystemId ?? universeIndex?.startSystemId;
  const activeSystem = universeIndex?.systems.find((entry) => entry.id === currentSystemId);
  const activeGate = travel || loadingDestination ? null : system?.gates.find((gate) => gate.id === activeGateId) ?? null;
  const activeGateDestination = activeGate && universeIndex?.systems.find((entry) => entry.id === activeGate.destinationSystemId);
  const activePreview = activeGate && universeIndex
    ? (() => {
      const preview = selectRoutePreview(universeIndex.edges.map((edge) => edge.systems), currentSystemId ?? universeIndex.startSystemId, activeGate.destinationSystemId);
      return {
        systems: preview.systems.flatMap((systemId) => {
        const previewSystem = universeIndex.systems.find((entry) => entry.id === systemId);
        return previewSystem ? [{ id: previewSystem.id, name: previewSystem.name }] : [];
        }),
        edges: preview.edges,
      };
    })()
    : null;
  const gates = (system?.gates ?? []).flatMap((gate) => {
    const destination = universeIndex?.systems.find((entry) => entry.id === gate.destinationSystemId);
    const edge = universeIndex?.edges.find((candidate) => candidate.gates.some((entry) => entry.id === gate.id) && candidate.gates.some((entry) => entry.id === gate.destinationGateId));
    return destination && edge ? [{ ...gate, destinationName: destination.name }] : [];
  });

  useEffect(() => {
    const probe = document.createElement("canvas");
    const context = probe.getContext("webgl2") ?? probe.getContext("webgl");
    setWebgl(context ? "ready" : "unavailable");
  }, []);

  useEffect(() => {
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setRenderPreferences(readRenderPreferences());
    window.addEventListener("resize", update);
    coarsePointer.addEventListener("change", update);
    reducedMotion.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      coarsePointer.removeEventListener("change", update);
      reducedMotion.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (webgl !== "ready") return;

    function reportContextLoss(event: Event): void {
      event.preventDefault();
      setWebgl("unavailable");
    }

    document.addEventListener("webglcontextlost", reportContextLoss, true);
    return () => document.removeEventListener("webglcontextlost", reportContextLoss, true);
  }, [webgl]);

  useEffect(() => {
    const controller = new AbortController();
    void loadJson<UniverseIndex>(`${import.meta.env.BASE_URL}data/universe-index.json`, controller.signal, "Universe index")
      .then(setUniverseIndex)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setDataError("The universe data could not be loaded. Reload the page to try again.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!universeIndex) return;
    const controller = new AbortController();
    void loadJson<SystemResource>(`${import.meta.env.BASE_URL}data/systems/${universeIndex.startSystemId}.json`, controller.signal, "Local system")
      .then((resource) => {
        resourceCache.current.set(universeIndex.startSystemId, resource);
        setSystem(resource);
        setActiveSystemId(universeIndex.startSystemId);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setDataError("The local system data could not be loaded. Reload the page to try again.");
      });
    return () => controller.abort();
  }, [universeIndex]);

  useEffect(() => () => travelController.current?.abort(), []);

  async function activateGate(gateId: number): Promise<void> {
    const gate = system?.gates.find((entry) => entry.id === gateId);
    const originSystemId = currentSystemId ?? universeIndex?.startSystemId;
    const originSystem = universeIndex?.systems.find((entry) => entry.id === originSystemId);
    const destinationSystem = universeIndex?.systems.find((entry) => entry.id === gate?.destinationSystemId);
    if (!gate || !universeIndex || !originSystem || !destinationSystem || originSystemId === undefined) return;
    const routeDirection = projectInterstellarRouteDirection(universeIndex.systems, originSystem.id, destinationSystem.id);

    travelController.current?.abort();
    const controller = new AbortController();
    travelController.current = controller;
    setTravelError(null);
    setFailedGateId(null);
    setActiveGateId(null);
    setDisplayedPreview(null);
    setLoadingDestination(true);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const destinationPromise = Promise.resolve(resourceCache.current.get(gate.destinationSystemId)
      ?? loadJson<SystemResource>(`${import.meta.env.BASE_URL}data/systems/${gate.destinationSystemId}.json`, controller.signal, "Destination system"));
    // An aborted replacement jump may return before this request is awaited.
    void destinationPromise.catch(() => undefined);
    const cacheDestination = (destination: SystemResource): void => {
      resourceCache.current.set(gate.destinationSystemId, destination);
      while (resourceCache.current.size > 3) resourceCache.current.delete(resourceCache.current.keys().next().value as number);
    };

    try {
      if (reducedMotion) {
        const destination = await destinationPromise;
        if (controller.signal.aborted) return;
        cacheDestination(destination);
        setSystem(destination);
        setActiveSystemId(gate.destinationSystemId);
        return;
      }

      const destination = await destinationPromise;
      if (controller.signal.aborted) return;
      cacheDestination(destination);

      const startedAt = performance.now();
      setTravel({ gateId, originSystemId, destinationSystemId: gate.destinationSystemId, routeDirection, phase: "accelerating", startedAt });
      await waitForTravel(ACCELERATION_DURATION, controller.signal);
      if (controller.signal.aborted) return;

      setSystem(destination);
      setActiveSystemId(gate.destinationSystemId);
      setActiveGateId(null);
      setTravel({ gateId, originSystemId, destinationSystemId: gate.destinationSystemId, routeDirection, phase: "decelerating", startedAt });
      await waitForTravel(DECELERATION_DURATION, controller.signal);
      if (controller.signal.aborted) return;
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setTravelError(`Unable to load the destination system. ${error instanceof Error ? "Try the gate again." : ""}`);
        setFailedGateId(gateId);
      }
    } finally {
      if (travelController.current === controller) {
        travelController.current = null;
        setTravel(null);
        setLoadingDestination(false);
      }
    }
  }

  useEffect(() => {
    if (activeGate && activePreview && activePreview.systems.length > 0) {
      setDisplayedPreview({ gateId: activeGate.id, ...activePreview, leaving: false });
      return;
    }

    if (!displayedPreview) return;
    setDisplayedPreview((preview) => preview && { ...preview, leaving: true });
    const timeout = window.setTimeout(() => setDisplayedPreview(null), 180);
    return () => window.clearTimeout(timeout);
  }, [activeGate?.id, activeGate?.destinationSystemId, universeIndex, system]);

  if (webgl === "checking") return <main className="loading">Preparing local system...</main>;
  if (webgl === "unavailable") return <SceneError message="WebGL is unavailable. Enable hardware acceleration or use a supported browser." />;
  if (dataError) return <SceneError message={dataError} />;
  if (!universeIndex) return <main className="loading">Preparing local system...</main>;

  return (
    <ErrorBoundary>
      <main className="star-map">
        <header className="system-hud">
          <p className="eyebrow">Local system</p>
          <h1>{activeSystem?.name ?? "Unknown system"}</h1>
          <p>Stellar cartography</p>
          {system?.star && <p className="star-details">{system.star.spectralClass} star · SDE type {system.star.typeId}</p>}
        </header>
        <aside className="physical-scale" aria-label="Physical scale">
          <p>Physical scale</p>
          <p>1 scene unit = {formatPhysicalValue(1 / LOCAL_SYSTEM_SCENE_UNITS_PER_METER)} m</p>
          <p>Planet and star bodies use SDE radii. Orbital ellipses use SDE radius and eccentricity in the shared Solar System Map plane. Gate brackets are screen aids.</p>
        </aside>
        <SceneViewport camera={camera} onCameraChange={setCamera} star={system?.star ?? null} planets={system?.planets ?? []} gates={gates} activeGateId={activeGateId} onGateActiveChange={setActiveGateId} onGateActivate={activateGate} travel={travel} previewGateId={displayedPreview?.gateId ?? null} previewSystems={displayedPreview?.systems ?? []} previewEdges={displayedPreview?.edges ?? []} previewLeaving={displayedPreview?.leaving ?? false} systemName={activeSystem?.name ?? "Unknown system"} snapshotTime={snapshotTime === null ? null : Number(snapshotTime)} celestialSystems={universeIndex.systems} activeSystemId={currentSystemId ?? universeIndex.startSystemId} quality={renderPreferences.quality} reducedMotion={renderPreferences.reducedMotion} />
        {displayedPreview && (
          <aside aria-label="Jump preview tree" className="route-preview" data-leaving={displayedPreview.leaving || undefined} role="region">
            <p>Jump preview tree</p>
            <ol>
              {displayedPreview.systems.map((previewSystem) => <li key={previewSystem.id}>{previewSystem.name}</li>)}
            </ol>
          </aside>
        )}
        {travelError && <aside className="travel-error" role="alert"><p>{travelError}</p>{failedGateId !== null && <button onClick={() => void activateGate(failedGateId)} type="button">Retry stargate</button>}</aside>}
        <output className="screen-reader-status" aria-live="polite" role="status">
          {travel ? `${travelStatus(travel.phase)} ` : ""}{activeGateDestination ? `Stargate destination: ${activeGateDestination.name}. Jump preview: ${activePreview ? activePreview.systems.map((previewSystem) => previewSystem.name).join(", ") : ""}. ` : ""}{activeSystem?.name ?? "Unknown system"} local system. Camera distance {camera.distance.toFixed(2)}. Camera bearing {camera.azimuth.toFixed(2)}. Rotate by dragging and zoom with the wheel or pinch gesture.
        </output>
        <p className="interaction-hint" aria-hidden="true">Drag to orbit. Scroll or pinch to adjust distance.</p>
        <p className="data-attribution">© 2014 CCP hf. All rights reserved. "EVE", "EVE Online", "CCP", and all related logos and images are trademarks or registered trademarks of CCP hf. Starframe is not endorsed by or affiliated with CCP.</p>
      </main>
    </ErrorBoundary>
  );
}

function travelStatus(phase: TravelPhase): string {
  return phase === "accelerating" ? "Accelerating through the stargate." : "Decelerating into the destination system.";
}

function readRenderPreferences(): { quality: RenderQuality; reducedMotion: boolean } {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return {
    quality: selectRenderQuality({ width: window.innerWidth, devicePixelRatio: window.devicePixelRatio, coarsePointer: window.matchMedia("(pointer: coarse)").matches }),
    reducedMotion,
  };
}

function formatPhysicalValue(value: number | undefined): string {
  return value === undefined ? "Недоступно" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

async function loadJson<T>(url: string, signal: AbortSignal, resourceName: string): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${resourceName} request failed with ${response.status}`);
  return response.json() as Promise<T>;
}

function waitForTravel(duration: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, duration);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}
