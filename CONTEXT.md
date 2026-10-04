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
The spherical cap a Constellation occupies on the sky: the direction of the mean of its Solar System directions, and the angular radius reaching the farthest of them. A Sigil Figure is framed on that same cap - concentric with it, and drawn across it to exactly a fixed multiple of that radius - so a figure and its Solar Systems occupy one patch of sky rather than the figure sitting small and off to one side. A sculpted body's own depth can still carry its far corner a little past the cap, and it is that larger drawn extent that Glyph Occlusion reserves.
_Avoid_: screen bounding box, a radius in metres, the physical size of the Constellation, a figure smaller than its own Constellation, a drawn extent fitted rather than framed

**Glyph Occlusion**:
The rule that decides which glyphs are drawn. Constellations are taken nearest first, by the distance to their closest Solar System, and one is kept only when its drawn extent clears every already-kept glyph's drawn extent with room to spare. The sphere a Constellation reserves is centred on its own Solar Systems and reaches the furthest thing it draws, so how densely a body happens to be triangulated has no say in it. A Constellation blocked by something in front of it is dropped whole. The Constellation the observer stands in surrounds them rather than occupying a patch of sky, so it is always drawn and never claims room.
_Avoid_: hiding individual stars, trimming a glyph, a depth buffer, selection by Stargate connectivity or by a fixed radius

**Legibility Floor**:
The smallest Glyph Footprint radius still worth drawing. A Constellation below it cannot be read as a figure at any camera zoom, so it is left out rather than added as clutter.
_Avoid_: culling by distance, keeping a fixed top-N, fading small glyphs in and out

**Glyph Integrity**:
A Constellation Glyph is shown whole or not at all: opacity belongs to the glyph, not to its nodes or its figure. The single exception is the Solar System the observer is standing inside, which has no direction in the sky and hands off to the Solar System Map as the observer approaches it.
_Avoid_: fading one node, hiding one star behind another, a glyph missing its far side

**Sigil Figure**:
One sculpted body from the shared library - a bolt, an atom, a ring, a hammer, a wedge of cheese, a gear, a diamond, a wolf, a vessel - with anchors on its most characteristic extremities, where real Solar Systems are meant to land. A figure has an inherent upright and is only ever tilted slightly within its Glyph Frame, because a crown lying on its side stops being a crown. Where it stands and how big it comes out are not fitted: the body is framed on the Glyph Footprint by rule. The anchors settle one thing only - the slight turn that brings the most of them onto real Solar Systems while leaving the fewest standing in empty sky - and the move stays a similarity that never reshapes the body.
_Avoid_: a body built out of flat line art by rule, a shape derived from Solar System positions, a figure generated per Constellation, free rotation within the frame, a silhouette that needs fill or colour to read, a body shrunk by least squares onto the stars it happened to match, a figure centred on its matched anchors rather than on its Constellation

**Sigil Motif**:
The one Sigil Figure a Constellation wears everywhere in New Eden. An offline generator turns every stationary Solar System's visible glyphs into a weighted co-visibility graph: pairs seen together are neighbours, with close pairs and pairs seen from many Systems weighted most heavily. The whole Sigil Figure library colours that graph deterministically and commits the assignment with the SDE build. With too few figures, unavoidable repeats are assigned to the weakest edges; adding figures can only split those conflicts until a large enough library leaves none. The app only reads that global assignment, never changing it for a particular observer.
_Avoid_: a choice per current sky, a figure that changes during travel or between sessions, random assignment, ignoring the rest of the library

**Glyph Depth Cue**:
The relative brightness of a Constellation Glyph stroke. Strokes physically nearer to the observer are brighter and overlap dimmer distant ones without changing the glyph's assigned hue; a Sigil Figure's strokes inherit the depth of the Solar Systems they run past. Because brightness against distance is a power law, it runs on the logarithm of that distance between a near and a far mark authored from the SDE build and reaching the distances a glyph is really drawn at, so a glyph five light years out and one twenty-four light years out are told apart rather than both resting at the end of the ramp. Nearly all of a stroke's light is the cue's to hand out; the floor under it is only what keeps the farthest drawn glyph from disappearing. The same depth also sets the order Glyph Occlusion works in. How wide a stroke comes out is not its business: that is the Glyph Pen across one glyph and Glyph Relief within one body.
_Avoid_: physical edge thickness, bloom-heavy solid object, a depth invented for artwork, changing a glyph from violet to cyan as the observer moves, a ramp that saturates short of the glyphs on the sky, brightness normalized against the glyphs currently in the sky

**Glyph Pen**:
How wide every stroke of one Constellation Glyph is drawn, from how large that glyph stands on the sky. A stroke's width is in screen pixels, so without this a figure drawn across a few degrees carried the same halo as one filling the sky: its lines fell closer together than their own glows were wide, the glow piled on itself, and a far sigil read brighter than a near one however the Glyph Depth Cue was set, because the piling is geometry rather than light. So a glyph drawn small is drawn with a finer pen - the pen follows the Glyph Footprint radius, and the drawing is a scale model of itself, so two lines stand as far apart relative to their own width however far away the figure is. It clamps at both ends, because a core line is about a pixel to begin with and the few glyphs that wrap most of the sky need no blot of a pen. It is one number for a whole glyph: brightness is the Glyph Depth Cue's, which side of its own body a line is on is Glyph Relief's, and a Glyph Star takes no part in it.
_Avoid_: physical edge thickness, a width per stroke, a width fitted to the glyphs currently in the sky, a pen that changes with camera zoom, a Glyph Star resized by it, a figure reshaped rather than redrawn

**Glyph Relief**:
What makes a Sigil Figure read as a body rather than as wire. Every line carries where each of its two ends stands through the figure's own depth - 1 at the body's nearest point to the observer and 0 at its farthest - and from that one number a line on the near side is drawn wider and anything behind the front of the body is drawn softer. It is line weight and focus, a draughtsman's convention rather than a measurement of the edge, and it is read inside the one body, which is what lets a near glyph and a far one be drawn with the same relief. The two ends of an edge differ, so an edge running away from the observer tapers and loses focus along its own length. It is measured from the observer, so it turns with Glyph Parallax and an orbit of the camera cannot touch it. A Glyph Star takes no part in it: a node's size is Glyph Star Size, from distance alone.
_Avoid_: physical edge thickness, a true perspective taper over a figure a few degrees across, a depth-of-field blur over the camera's whole view, relief measured from the camera, one width for a whole edge, relief normalized against the other glyphs on the sky, a Glyph Star resized by it

**Glyph Colouring**:
A colouring of the Relative Neighbourhood Graph formed by the Constellation Glyphs on the current sky. Immediate visual neighbours receive different hues from the shared cool neon palette. A journey is coloured before motion begins and then holds those hues for every travel frame; at that boundary, only a glyph whose old hue would collide with a new neighbour is reassigned. After a glyph leaves the sky completely, its hue may be reused and the glyph may receive another when encountered again.
_Avoid_: permanent Region colour, spectral star colour, Stargate-connectivity colouring, recolouring every travel frame, a unique hue for every Constellation in New Eden

**Jump Preview Tree**:
The deduplicated breadth-first tree of up to three Stargate jumps that begins with the Stargate under hover or focus, rendered as arcs on the Celestial Map.
_Avoid_: linear route preview, persistent selected route

**Distance Cue**:
The relative brightness of a Celestial Map star, which decreases with its distance from the active Solar System. Its near/mid/far core-and-halo appearance (a sharper, more compact point up close; a wider, more halo-dominant glow far away) is a presentation of this same brightness value at a fixed physical distance threshold - it never relocates a Solar System on the Celestial Map sphere or renormalizes to the current dataset's nearest or farthest system. The whole field, procedural background stars included, is drawn at a fixed fraction of the light it asks for, so the stars of the Constellation a Glyph is drawn on are read as its Glyph Stars rather than lost in the sky behind them; one shared fraction leaves every star's place in the near/far order untouched.
_Avoid_: physical stellar luminosity, generated background star, physical movement toward or away from the observer, dataset-relative min/max normalization, dimming only the stars outside a visible Glyph

**Minimum Map Brightness**:
The brightness floor for the most distant Celestial Map stars. It remains higher than the brightness of procedural background stars, so every New Eden Solar System stays distinguishable.
_Avoid_: distance culling, decorative background star

**Spectral Tint**:
A restrained colour cue derived from a Solar System's real SDE spectral class, shared by its core and halo at different strengths - most visible on the core and softened on the halo so a dense cluster's combined glow never paints a large sky region one aggressive hue. A dense cluster's combined halo colour is the additive sum of its member stars' own tints, not a separately authored region colour.
_Avoid_: physically exact stellar colour temperature, random or region-based tint, an aggregate glow colour with no per-star source

**Glyph Star Spikes**:
Eight screen-space arms drawn around every Solar System node belonging to a currently visible Constellation Glyph. Four of the arms reach out and brighten while the four between them draw in and dim, trading places over a cycle of a few seconds, so the star twinkles rather than pulsing as a whole; that twinkle starts from a phase fixed by the System's own identity, which also leans the star onto one pair of its optical axes for good. Ordinary Celestial Map stars never receive spikes because of brightness, radius, or local density, and every arm is read several times within each pixel, so the pixel grid cannot make one stutter as the camera turns.
_Avoid_: physical telescope diffraction, stellar-luminosity indicator, spikes on stars outside visible Glyphs, synchronized flashing, a whole-star brightness pulse

**Glyph Star Light**:
How a Glyph Star is coloured: a white-hot core, arms carrying the Glyph's own assigned colour, and a wide haze of that colour around them, with the far half of each arm deepening into it and its channels spread slightly apart. It is what identifies a star as part of that figure rather than a Celestial Map star, and it is light with a temperature across it, not one fill tinted at the end.
_Avoid_: one flat colour over the whole star, a tint applied to a finished white flare, Spectral Tint, a colour that says anything about the star itself

**Glyph Star Size**:
The drawn diameter of a Glyph Star, which grows as the observer's Solar System comes closer to the star's own. It falls off on the same distance scale as the Distance Cue, so size and map brightness tell one story about distance; nothing about it is normalized against the glyphs currently in the sky, so a star keeps its size when its neighbours leave and growing always means the observer came closer.
_Avoid_: physical stellar radius, dataset-relative min/max normalization, a size that changes with camera zoom, Glyph Depth Cue

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
