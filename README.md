# Starframe

Starframe is an experimental, interactive map of New Eden built from official
EVE Online static data. Explore solar systems, look across the surrounding sky,
and travel through the stargate network.

[Open the live demo](https://mygodishe.github.io/starframe/)

![Starframe showing the Amarr system and celestial map](docs/screenshot-amarr.png)

## Features

- Solar systems positioned and scaled from the EVE Online Static Data Export
- Stars, planets, orbital paths, and stargates shown in each local system
- A celestial map of New Eden with constellation glyphs
- Stargate destinations, route previews, and animated travel between systems
- Deterministic ambient flights and battle activity across the map
- Desktop, touch, reduced-motion, and lower-power rendering profiles

Starframe is a visualisation rather than a tactical or live-intelligence tool.
Its ambient activity is simulated and does not represent events from EVE
Online.

## Controls

- Drag to orbit around the current system.
- Scroll or pinch to change distance.
- Hover or focus a stargate to preview its destination and onward route.
- Select a stargate to travel to the connected system.

## Sigil Figures

Constellations are marked by sculpted figures designed to remain recognisable
from different viewpoints. The separate
[Sigil Figure gallery](https://mygodishe.github.io/starframe/sigil.html) lets you
inspect each figure in isolation and move the observer around it.

## Requirements

- Node.js 24
- npm 11
- A browser with WebGL enabled

## Development

```sh
npm ci
npm run dev
```

The development server prints the local URL for the map. The Sigil Figure
gallery is available at `/sigil.html`.

## Checks

```sh
npm run check
npm run test:e2e
```

Install the Playwright browser once with `npx playwright install chromium` if
it is not already available.

## Data

The checked-in universe dataset was generated from the official EVE Online
JSON Lines Static Data Export. Its build, source URL, and format are recorded
in [`sde.config.json`](sde.config.json).

## Project Status

Starframe is experimental. Its interface, visual design, and generated data
may change between commits.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
[SECURITY.md](SECURITY.md) for responsible vulnerability reporting.

## License and EVE Online Data

Starframe's source code is available under the [MIT License](LICENSE).
EVE Online game data and CCP intellectual property are not covered by that
license. See [NOTICE.md](NOTICE.md) for data provenance, the required CCP
notice, and the applicable EVE Online Developer License Agreement.
