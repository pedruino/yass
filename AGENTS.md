# Conventions

## Comments — only the necessary (Clean Code, strict)

Code must read on its own. A comment is a last resort, not a habit.

**Write a comment only when:**
- It explains **why**, not what: a non-obvious decision, tradeoff, or constraint the code cannot show.
- It warns of a real gotcha (race, platform quirk, security reason, order dependency).
- It documents an external contract (payload shape, protocol) that isn't visible locally.

**Never write:**
- Comments that restate the code (`// increment i`, `// return the result`).
- Decorative banners / section dividers (`// ==== Section ====`).
- Commented-out code (delete it; git remembers).
- Redundant doc headers on self-evident functions.

**Prefer instead:** intention-revealing names, small functions, early returns. If a comment feels needed to explain *what*, rename or extract until it doesn't.

One honest line of *why* beats five lines narrating *what*.
