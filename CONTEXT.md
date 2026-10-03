# Starframe

This context presents EVE Online universe and local-system information as an interactive map.

## Local-System Cartography

**Solar System Map**:
A schematic view of celestial bodies orbiting within one EVE solar system.
_Avoid_: tactical map, galaxy map

**Recovered Orbit**:
A static orbital geometry derived from SDE celestial statistics for a specific data build.
_Avoid_: decorative orbit, arbitrary orbit

**Solar System Plane**:
The shared presentation plane on which the Solar System Map arranges planetary ellipses with complete SDE orbit statistics.
_Avoid_: physical orbital inclination, planet-specific orbital plane

## Interstellar Cartography

**Celestial Map**:
A camera-centred projection of every New Eden Solar System onto the distant celestial sphere, viewed from the active Solar System.
_Avoid_: local-system object, decorative background star

**Constellation Glyph**:
A holographic sigil standing in space where its Constellation is: the Sigil Figure its Sigil Motif names, laid out in the Glyph Frame so the figure's anchors fall on the real Solar Systems. Every member remains visible as its Celestial Map star, but no line ties the figure to those stars. The figure is authored art, as in a star atlas, so the lines are not derived from the positions - the placement is. Stargates select nothing and define no line.
_Avoid_: Stargate graph, convex hull wireframe, a polygon drawn through the Solar Systems, enclosing volume, connector from the figure to a Solar System, partial glyph

**Glyph Frame**:
The Constellation's own coordinate frame, built once from the SDE build and never from an observer: the centre of its Solar Systems, the plane they most nearly lie in, and the galactic vertical laid into that plane as up. A glyph is laid out here and then stays put, so travel turns it rather than redrawing it, and its relief comes from how far its Solar Systems really sit off that plane.
_Avoid_: the observer's sky plane, a per-frame fitted orientation, a plane chosen to face the camera

**Glyph Parallax**:
What a pilot gets from a glyph being a fixed object: moving through New Eden shows it from another side, foreshortened or face on, without any of its geometry changing. A glyph seen nearly edge on reads as a sliver, and that is the honest view of a thing with volume.
_Avoid_: re-fitting a glyph to the current viewpoint, turning a glyph to face the camera, parallax within one stationary view

**Glyph Footprint**:
The spherical cap a Constellation occupies on the sky: the direction of the mean of its Solar System directions, and the angular radius reaching the farthest of them. A Sigil Figure is drawn out to a fixed multiple of that radius, and it is the larger drawn extent that Glyph Occlusion reserves.
_Avoid_: screen bounding box, a radius in metres, the physical size of the Constellation

**Glyph Occlusion**:
The rule that decides which glyphs are drawn. Constellations are taken nearest first, by the distance to their closest Solar System, and one is kept only when its drawn extent clears every already-kept glyph's drawn extent with room to spare. A Constellation blocked by something in front of it is dropped whole. The Constellation the observer stands in surrounds them rather than occupying a patch of sky, so it is always drawn and never claims room.
_Avoid_: hiding individual stars, trimming a glyph, a depth buffer, selection by Stargate connectivity or by a fixed radius

**Legibility Floor**:
The smallest Glyph Footprint radius still worth drawing. A Constellation below it cannot be read as a figure at any camera zoom, so it is left out rather than added as clutter.
_Avoid_: culling by distance, keeping a fixed top-N, fading small glyphs in and out

**Glyph Integrity**:
A Constellation Glyph is shown whole or not at all: opacity belongs to the glyph, not to its nodes or its figure. The single exception is the Solar System the observer is standing inside, which has no direction in the sky and hands off to the Solar System Map as the observer approaches it.
_Avoid_: fading one node, hiding one star behind another, a glyph missing its far side

**Sigil Figure**:
One sculpted body from the shared library - a bolt, an atom, a ring, a hammer, a wedge of cheese, a wolf, a vessel - with anchors on its most characteristic extremities, where real Solar Systems are meant to land. A figure has an inherent upright and is only ever tilted slightly within its Glyph Frame, because a crown lying on its side stops being a crown. The fit moves the whole body onto the stars - turn, scale, shift - and never reshapes it.
_Avoid_: a body built out of flat line art by rule, a shape derived from Solar System positions, a figure generated per Constellation, free rotation within the frame, a silhouette that needs fill or colour to read

**Sigil Motif**:
Which Sigil Figure a Constellation wears, chosen from its real name and Region, together with the caption naming the idea.
_Avoid_: a randomly picked figure, one figure shared by a whole Region, a choice that changes between sessions

**Glyph Depth Cue**:
The relative sharpness, brightness, width, and colour of a Constellation Glyph stroke. Strokes physically nearer to the observer are sharper cyan and overlap thinner violet distant ones; a Sigil Figure's strokes inherit the depth of the Solar Systems they run past. The same depth also sets the order Glyph Occlusion works in.
_Avoid_: physical edge thickness, bloom-heavy solid object, a depth invented for artwork

**Jump Preview Tree**:
The deduplicated breadth-first tree of up to three Stargate jumps that begins with the Stargate under hover or focus, rendered as arcs on the Celestial Map.
_Avoid_: linear route preview, persistent selected route

**Distance Cue**:
The relative brightness of a Celestial Map star, which decreases with its distance from the active Solar System. Its near/mid/far core-and-halo appearance (a sharper, more compact point up close; a wider, more halo-dominant glow far away) is a presentation of this same brightness value at a fixed physical distance threshold - it never relocates a Solar System on the Celestial Map sphere or renormalizes to the current dataset's nearest or farthest system.
_Avoid_: physical stellar luminosity, generated background star, physical movement toward or away from the observer, dataset-relative min/max normalization

**Minimum Map Brightness**:
The brightness floor for the most distant Celestial Map stars. It remains higher than the brightness of procedural background stars, so every New Eden Solar System stays distinguishable.
_Avoid_: distance culling, decorative background star

**Spectral Tint**:
A restrained colour cue derived from a Solar System's real SDE spectral class, shared by its core, halo and diffraction spikes at different strengths - most visible on the core, softened on the halo so a dense cluster's combined glow never paints a large sky region one aggressive hue, and softened further still on a diffraction spike. A dense cluster's combined halo colour is the additive sum of its member stars' own tints, not a separately authored region colour.
_Avoid_: physically exact stellar colour temperature, random or region-based tint, an aggregate glow colour with no per-star source

**Visible Brightness**:
A Solar System's own individual presentation brightness - a fixed function of its Distance Cue and its SDE star radius alone - used only to decide whether it earns a Diffraction Cue. It is read before any neighbouring System's halo is added in, so crowding a sky region with dim stars can never raise it, and one irrelevant extreme System can never change another System's reading.
_Avoid_: physical stellar luminosity, a value read from the rendered framebuffer or halo accumulation, neighbour count or local density

**Diffraction Cue**:
A rare screen-space spike drawn only on the individual Solar Systems whose Visible Brightness clears a fixed threshold - a presentation accent for exceptional individual brightness, not a measure of how crowded the surrounding sky is. A dense cluster of otherwise-ordinary stars earns no spikes on its own.
_Avoid_: physical telescope diffraction, a density or cluster-brightness indicator, dynamic top-N selection that reorders during Stargate travel

**Sky Backdrop**:
A single faint, camera-centred shading layer drawn behind every Celestial Map star: a near-black field with slow direction-space noise and darker wide streaks, fixed relative to sky direction rather than the camera's orientation or travel position. It supports the impression of galactic structure but never substitutes for it.
_Avoid_: decorative background star, procedural nebula as a light source, time-animated effect

**Battle Window**:
A deterministic rise-plateau-decay span during which one Solar System hosts a procedural battle, computed from that System, its Region, and wall-clock time alone.
_Avoid_: real combat data, persistent battle log

**Conflict Hotspot**:
The stable per-Region weighting that makes some Regions host Battle Windows far more often than others.
_Avoid_: uniform battle frequency, per-system independent noise

**Battle Beacon**:
The Celestial Map cue for a Solar System's active Battle Window: a faint warm idle tint on its Distance Cue brightness, punctuated by a discrete flash-and-ring for each Explosion Event the System is currently hosting. Frequent overlapping flashes, not a brighter idle tint, are what read as a large battle.
_Avoid_: tactical map, second distance metric, continuous flicker

**Explosion Event**:
A single ship's death: a deterministic, independently-timed flash, then an expanding shell, then a fading scar, generated from a Battle Window at a rate its Tier and current intensity set. The same events drive both the Battle Flare and the Battle Beacon, so what a distant Battle Beacon pulses is what a traveller finds on arrival.
_Avoid_: periodic pulse, one shared clock across every ship

## Local-System Battle Cartography

**Battle Flare**:
The in-system rendering of a Solar System's Explosion Events at its Stargates and Planets: a bright core, an expanding shockwave shell, and a lingering, fading scar per ship, layered over a faint constant tint at each active site. Many overlapping scars are what make a location read as a warzone.
_Avoid_: bloom-heavy solid object, single ambient glow standing in for many ships
