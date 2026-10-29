# Frontend TypeScript migration status

The React entrypoint and all React view/component files in `frontend/src` use `.tsx`; internal React imports use the `.tsx` extensions. The previous React `.jsx` files were removed.

## What the current build guarantees

- `tsc --noEmit` runs before `vite build` and catches parser/import/type errors in files that are actively type-checked.
- `main.tsx`, `components/SettingsPage.tsx`, and `components/WeightChart.tsx` are actively type-checked.
- The project uses React Router, TanStack Query, React Hook Form, Recharts, Tailwind CSS and vite-plugin-pwa with Workbox.

## Explicit migration debt

The pre-existing screens were originally untyped JavaScript. To keep the first TSX conversion behavior-preserving, several migrated screens carry a top-of-file `// @ts-nocheck` marker while their implicit prop contracts, form data, and API response types are extracted. This is a temporary compatibility measure, not a claim that those screens are already type-safe.

The migration also retains `api.js`, `qr.js`, `vite.config.js`, and the Workbox service worker `sw.js`. The TypeScript compiler currently has `strict: false`; do not claim strict TypeScript compliance.

## Follow-up sequence

1. Define shared API response/request types and an explicit `NoticeHandler` callback type.
2. Replace implicit component props with exported interfaces and type form values per domain.
3. Remove `@ts-nocheck` one component at a time with tests and visible CI results.
4. Enable `strict: true` and no-unused checks after the migrated modules pass without suppressions.
5. Consider converting the browser API and QR utilities to TypeScript separately, with behavior tests.

A PR is not ready to merge solely because the TSX build passes; runtime browser tests and the API integration suite must also pass.
