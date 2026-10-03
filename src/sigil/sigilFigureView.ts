import type { ConstellationGlyph } from "../constellations/constellationGlyphModel";
import { drawnEdges, isVertexVisible, type SolidPoint } from "../constellations/glyphSolid";
import type { SigilModel } from "../constellations/sigilModel";
import type { Vector3 } from "../universe/generateUniverse";

// One sculpted Sigil Figure, drawn on its own.
//
// The sky draws a figure as part of a Constellation: fitted to its real Solar Systems, laid out in
// its Glyph Frame, projected onto the celestial sphere and ranked against every other glyph for
// room. None of that says whether the body itself reads as the animal it is meant to be, and the
// contact sheets answer it only one still at a time. So this hands a single model to the same
// renderer the sky uses, with the Constellation taken out of it, and lets a pilot walk round it.
//
// The one rule it keeps exactly is the one that matters: which lines exist is decided from the
// observer's position, not from the camera's. Moving the observer round the model turns it and
// changes its outline - that is Glyph Parallax. Leaving the observer where it is and moving only
// the camera changes nothing at all, which is the other half of the same rule and the reason the
// page can show both.

const WORKSHOP_CONSTELLATION_ID = 0;

/** How far out the observer stands from a model that reaches the unit sphere. */
export const WORKSHOP_OBSERVER_DISTANCE = 3.4;

export function observerPosition(azimuth: number, elevation: number, distance = WORKSHOP_OBSERVER_DISTANCE): SolidPoint {
  const horizontal = Math.cos(elevation) * distance;
  return [Math.sin(azimuth) * horizontal, Math.sin(elevation) * distance, Math.cos(azimuth) * horizontal];
}

// Everything the renderer needs, in the shape the sky hands it: the body's visible edges as strokes
// on the ladder, and the figure's anchors as the nodes a real Solar System would stand on.
export function viewSigilFigure(model: SigilModel, observer: SolidPoint): ConstellationGlyph {
  const strokes = drawnEdges(model.solid, observer).map((line) => ({
    kind: line.kind,
    from: line.from as Vector3,
    to: line.to as Vector3,
    opacity: 1,
    proximity: proximityOf(midpoint(line.from, line.to), observer),
  }));

  // On the sky a node is a real Solar System, which is never hidden - Glyph Integrity is explicit
  // that opacity belongs to the glyph and not to its nodes. Here a node is not a star at all: it is
  // the point on the model's own surface where a star is meant to land, so the body covers it like
  // anything else on its far side. An anchor marker floating through the chest would say the body is
  // made of glass, which is exactly what it is not.
  const nodes = model.anchors
    .filter((anchor) => isVertexVisible(model.solid, anchor.vertex, observer))
    .map((anchor) => ({
      systemId: anchor.vertex,
      position: anchor.position as Vector3,
      opacity: 1,
      proximity: proximityOf(anchor.position, observer),
    }));

  return { constellationId: WORKSHOP_CONSTELLATION_ID, opacity: 1, nodes, strokes };
}

// Glyph Depth Cue, over the one object on the page: the near side of the body is sharp cyan and its
// far side violet. On the sky the same value comes from how far away the Solar Systems a stroke runs
// past really are, which is a distance no single figure has; here the model's own radius stands in
// for it, so the cue reads as relief rather than as a claim about distance.
export function proximityOf(point: SolidPoint, observer: SolidPoint): number {
  const reach = Math.hypot(observer[0], observer[1], observer[2]);
  const near = Math.max(reach - 1, 1e-6);
  const far = reach + 1;
  const distance = Math.hypot(point[0] - observer[0], point[1] - observer[1], point[2] - observer[2]);
  return Math.max(0, Math.min(1, (far - distance) / (far - near)));
}

function midpoint(from: SolidPoint, to: SolidPoint): SolidPoint {
  return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
}
