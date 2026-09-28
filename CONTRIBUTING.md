# Contributing

Thank you for helping improve Starframe.

## Before Opening a Change

Use a GitHub issue to describe substantial features or behaviour changes
before implementation. Bug fixes and focused documentation improvements can
go directly to a pull request.

Do not commit credentials, local environment files, downloaded SDE archives,
or generated test reports. Changes that introduce new EVE Online data must
remain compatible with the EVE Online Developer License Agreement.

## Development Workflow

1. Install Node.js 24 and npm 11.
2. Run `npm ci`.
3. Create a focused branch from `main`.
4. Add or update tests with the implementation.
5. Run `npm run check` and `npm run test:e2e`.
6. Open a pull request explaining the user-visible change and its verification.

Visual changes should include intentional Playwright snapshot updates for each
supported platform. Avoid updating snapshots to hide unexplained rendering
differences.

## Commit and Pull Request Scope

Keep commits focused and use imperative commit subjects. A pull request should
avoid unrelated formatting, generated-data, or dependency changes.
