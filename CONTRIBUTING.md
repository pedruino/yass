# Contributing to YASS

Small project, local-first, no corporate strings attached. The bar: **simple, accessible, tested**.

## Flow

1. Open an issue (bug or idea).
2. Branch from `main`: `type/name-kebab-case`.
3. Implement and commit to the convention.
4. Green on lint + build.
5. PR to `main` with `Closes #N`.

`main` is trunk. No `develop`/`release`.

## Branches

`feat/` · `fix/` · `docs/` · `refactor/` · `chore/`, plus the name in kebab-case.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): imperative summary`.

Types: `feat` `fix` `docs` `refactor` `chore` `test` `perf` `style`.
Scopes: `daemon` `app` `voice` `persona` `hook` `design`.

```
fix(daemon): handle OPTIONS so cross-origin preflight does not 404
feat(app): dynamic quick phrases from the most-used utterances
```

## Pull Requests

- 1 PR = 1 cohesive change. Small reviews fast.
- Say **what** and **why**; link the issue.
- **UI changes require visual evidence**: before/after screenshot + a11y note if applicable.
- Green on lint + build before requesting review.

## Style and accessibility

The UI aims for a premium bar (Linear/Arc/Raycast); **WCAG 2.1 AA is a requirement**, not polish.

- Design tokens are the single source in `app/src/index.css` (`@theme` + shadcn vars). Do not hardcode color/spacing.
- Text contrast >= 4.5:1.
- Interactive elements: visible focus, keyboard, `aria-label` on icon buttons, target >= 24px. Prefer shadcn/Radix.
- Tooltips **always** via `Hint`/`HintTerm`, never the native `title`.
- Respect `prefers-reduced-motion`.

## Local checks

```bash
node --check yass-daemon.js                  # daemon: syntax sanity
cd app && npm install && npm run lint && npm run build
```

Test a voice without restarting: **⚙ → Test voice** panel, or

```bash
curl -XPOST localhost:3891/speak -H 'Content-Type: application/json' -d '{"text":"test"}'
```
