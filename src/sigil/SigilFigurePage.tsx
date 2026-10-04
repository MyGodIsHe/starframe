import { type ReactNode, useEffect, useState } from "react";
import { ErrorBoundary, SceneError } from "../ErrorBoundary";
import { RepositoryLink } from "../RepositoryLink";
import type { CameraState } from "../orbitCamera";
import { selectRenderQuality, type RenderQuality } from "../renderQuality";
import { SIGIL_MODELS, type SigilModel } from "../constellations/sigilModel";
import { SigilFigureViewport } from "./SigilFigureViewport";
import { observerPosition } from "./sigilFigureView";

// The page a sculpted Sigil Figure is judged on.
//
// A contact sheet answers whether a figure reads from one angle. The only question that matters for
// a body is whether it reads from all of them, and whether its outline changes the way a real
// object's does when you move past it - so the page is one figure, in the dark, that a pilot turns.
//
// Two of the project's rules are visible here rather than described. Which lines exist is decided
// from where the observer stands, so dragging moves the observer and the figure turns. Holding the
// observer still and moving only the camera changes nothing: a glyph hides the same far side
// whatever angle you look at it from, which is why orbiting the sky can never redraw one.

// Off the figure's own front to start with, and a little above its equator. Square on is the one
// view that hides what a body is - a bolt square on is a drawing of a bolt - and this page exists to
// show the far side going round. Far enough off to say so, near enough that every figure in the
// library still reads as the thing it is.
const INITIAL_CAMERA: CameraState = { azimuth: 0.3, elevation: 0.2, distance: 2.5 };

export default function SigilFigurePage(): ReactNode {
  const requested = new URLSearchParams(window.location.search).get("figure");
  const [webgl, setWebgl] = useState<"checking" | "ready" | "unavailable">("checking");
  const [camera, setCamera] = useState(INITIAL_CAMERA);
  const [held, setHeld] = useState<{ azimuth: number; elevation: number } | null>(null);
  const [preferences, setPreferences] = useState(readRenderPreferences);
  const model = SIGIL_MODELS.find((candidate) => candidate.name === requested) ?? SIGIL_MODELS[0] ?? null;

  useEffect(() => {
    const probe = document.createElement("canvas");
    setWebgl(probe.getContext("webgl2") ?? probe.getContext("webgl") ? "ready" : "unavailable");
  }, []);

  useEffect(() => {
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setPreferences(readRenderPreferences());
    window.addEventListener("resize", update);
    coarsePointer.addEventListener("change", update);
    reducedMotion.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      coarsePointer.removeEventListener("change", update);
      reducedMotion.removeEventListener("change", update);
    };
  }, []);

  if (webgl === "checking") return <main className="loading">Preparing the figure...</main>;
  if (webgl === "unavailable") return <SceneError message="WebGL is unavailable. Enable hardware acceleration or use a supported browser." />;
  if (!model) return <NothingImported />;

  const observer = observerPosition(held?.azimuth ?? camera.azimuth, held?.elevation ?? camera.elevation);

  return (
    <ErrorBoundary>
      <main className="sigil-figure">
        <header className="system-hud">
          <p className="eyebrow">Sigil figure</p>
          <h1>{titleCase(model.name)}</h1>
          <p>Sculpted body</p>
          <p className="star-details">{model.anchors.length} anchors · drawn from an observer, not from the camera</p>
        </header>
        <FigureFacts model={model} held={held !== null} />
        <SigilFigureViewport model={model} camera={camera} observer={observer} onCameraChange={setCamera} quality={preferences.quality} reducedMotion={preferences.reducedMotion} />
        <aside className="sigil-controls" aria-label="Observer">
          <p>Observer</p>
          <button
            aria-pressed={held !== null}
            onClick={() => setHeld(held ? null : { azimuth: camera.azimuth, elevation: camera.elevation })}
            type="button"
          >
            {held ? "Release the observer" : "Hold the observer here"}
          </button>
          <p className="sigil-controls__note">
            {held
              ? "The camera moves and the figure does not: the far side stays hidden from where the observer stands."
              : "Dragging walks the observer round the figure, and its outline turns with them."}
          </p>
          {SIGIL_MODELS.length > 1 && (
            <ul className="sigil-controls__figures">
              {SIGIL_MODELS.map((candidate) => (
                <li key={candidate.name}><a href={`?figure=${candidate.name}`} aria-current={candidate.name === model.name || undefined}>{titleCase(candidate.name)}</a></li>
              ))}
            </ul>
          )}
        </aside>
        <output className="screen-reader-status" aria-live="polite" role="status">
          Sigil figure {model.name}, a sculpted body of {model.solid.faces.length} faces imported from {model.source}. Observer bearing {(held?.azimuth ?? camera.azimuth).toFixed(2)}, elevation {(held?.elevation ?? camera.elevation).toFixed(2)}, camera distance {camera.distance.toFixed(2)}. Drag to walk the observer round the figure and scroll to change the camera distance.
        </output>
        <p className="interaction-hint" aria-hidden="true">Drag to walk round. Scroll or pinch to come closer.</p>
        <RepositoryLink />
      </main>
    </ErrorBoundary>
  );
}

// No sculpted body is committed to the repository, so this is the page's ordinary first state and
// not a failure: nothing went wrong, there is simply nothing to turn yet.
function NothingImported(): ReactNode {
  return (
    <main className="sigil-figure">
      <header className="system-hud">
        <p className="eyebrow">Sigil figure</p>
        <h1>Nothing imported</h1>
        <p>Sculpted body</p>
      </header>
      <aside className="physical-scale" aria-label="Sculpted body">
        <p>Figure</p>
        <p>No sculpted body ships with this repository. A model is somebody else&apos;s sculpture, and whether it may be redistributed is their decision rather than a star map&apos;s.</p>
        <p>Import one you have the right to use:</p>
        <p><code>npx tsx scripts/import-sigil-model.ts model.stl --name=wolf</code></p>
        <p>Then add the file it writes to the list in <code>src/constellations/sigilModel.ts</code>, and it appears here.</p>
      </aside>
      <RepositoryLink />
    </main>
  );
}

function FigureFacts({ model, held }: { model: SigilModel; held: boolean }): ReactNode {
  const marked = model.solid.edges.filter((edge) => edge.drawn).length;

  return (
    <aside className="physical-scale" aria-label="Sculpted body">
      <p>Figure</p>
      <p>{model.solid.faces.length} faces · {model.solid.edges.length} edges</p>
      <p>{marked} creases marked; the outline is found from the observer and never marked.</p>
      <p>From {model.source}. The body is not drawn per Constellation: it is one body, placed by the fit.</p>
      <p>{held ? "Observer held." : "Observer follows the drag."}</p>
    </aside>
  );
}

function readRenderPreferences(): { quality: RenderQuality; reducedMotion: boolean } {
  return {
    quality: selectRenderQuality({ width: window.innerWidth, devicePixelRatio: window.devicePixelRatio, coarsePointer: window.matchMedia("(pointer: coarse)").matches }),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

function titleCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
