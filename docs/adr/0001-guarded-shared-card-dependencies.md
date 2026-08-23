# ADR 0001 — Hub-managed card worktrees share dependencies, guarded on lockfile identity

**Status:** Accepted

Decided and measured on 2026-08-22 in
[lovelace-growspace-manager-card#706](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/706);
landed in card PR #710 and hub PR #7.

## Context

A card worktree needs `node_modules` before lint, typecheck, or the Vitest
browser suite will run. The hub creates those worktrees in bulk — `scripts/feature`
for a matched pair, `scripts/codex-worktree` for a Codex-managed one — so
whatever it does per worktree is multiplied by however many are alive at once.

Two things forced the question:

- The card's `CLAUDE.md` said worktrees do **not** share `node_modules` and that
  a shared one had been "considered and rejected". `scripts/feature` and
  `scripts/codex-worktree` symlinked it anyway. The documented policy was not the
  implemented one, and nothing enforced either.
- `~/dev` is ext4. There is no reflink, so `cp --reflink` is unavailable and a
  per-worktree copy costs the full tree every time.

The stated reason for not sharing was dependency drift: a worktree branch whose
`package.json` / `package-lock.json` differs from the main checkout's would test
against another branch's hoisting and peer-dependency resolution. That risk is
real — 1 of 11 card worktrees on the test machine already had a divergent
lockfile — but it is a property of *differing lockfiles*, not of sharing itself,
and differing lockfiles are cheap to detect.

## Measurements

From the #706 investigation, 2026-08-22:

| what | measured |
|---|---|
| dereferenced dependency tree | 465 MB on ext4 |
| warm offline private `npm ci` | ~2.4 s |
| hash + `npm ci --dry-run` guard | ~0.47 s |
| lockfile changes on `dev` first-parent history | two in 90 days, none additional back to 180 |
| shared **writable caches**, 10 concurrent worktree pairs | 4/10 timed out with a hung Vitest, vs 0/10 private |

Install *time* is not the deciding factor — 2.4 s is not "a few minutes of
install time per worktree", as the old text claimed. Disk is: 465 MB per
worktree, on a filesystem that cannot share blocks, across the number of
worktrees this hub keeps alive.

The last row is the reason sharing is scoped to *packages* and not to caches.
Sharing the dependency tree is safe; sharing the writable Vite optimiser cache
and browser-test reports inside it is not.

## Decision

**Hub-managed worktrees share the main card checkout's `node_modules` through a
single symlink, and only while the two checkouts provably agree on their
dependencies.** `scripts/card-node-modules` is the one implementation; both
setup paths call it.

The guard is two-layered:

1. The complete `package-lock.json` SHA-256 must be identical. This catches a
   *different dependency plan*.
2. An offline `npm ci --dry-run --ignore-scripts` in the worktree must report
   zero added, changed, and removed packages. This catches an install that no
   longer *realizes* an otherwise matching plan — a stale main checkout.

Either check failing removes the link and fails with the recipe to run a private
`npm ci`. An existing real `node_modules` directory is left alone and only
validated; it is never replaced by a link. Drift therefore fails closed.

A worktree created by hand shares nothing and runs its own `npm ci`.

Writable state moved out of the shared tree: Vite's optimiser cache and the
browser-test reports live under the checkout-local `.cache/`, and the Vitest
commands select Vite's `runner` config loader so no `node_modules/.vite-temp` is
created. Two full browser suites then ran concurrently from separate worktrees
against one shared tree (140 files / 3,344 tests each, 22.31 s) with both passing
and the shared `.vite` content and mtimes unchanged.

### The ownership boundary: the hub heals, the card detects

Setup paths — `scripts/feature`, `scripts/codex-worktree`, and
`scripts/card-node-modules` beneath them — may create a link, re-link, re-validate,
and remove a link that no longer holds.

**Card-side checks may refuse, and must never create a link.** A card-side guard
that found a mismatch and repaired it would silently re-establish sharing that
the hub had refused, using a policy the card has no standing to decide. Whether
one checkout's dependencies may back another is a property of how the pair was
created, which only the hub knows. So the card compares, reports, and stops; the
recipe it prints is unlink-then-`npm ci`, run by a human or by hub setup.

This split is why [card#727](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/727)
is scoped to refusal and not repair.

## Accepted risk: write-through, and why no hook can catch it

The shared link was previously described as "read-only by policy". That wording
reads stronger than the mechanics support. Measured against a symlinked
`node_modules`:

| verb | effect on the link | effect on the main checkout's tree |
|---|---|---|
| `npm ci`, `npm install` | link deleted, private install in its place | untouched |
| `npm rebuild`, `patch-package`, dependency postinstalls | link intact | **written through** |

The first row is recoverable and interceptable. npm runs the root package's
`preinstall` script *before* it removes anything, so a hook can turn an
accidental conversion into a deliberate one — that is what card#727 adds.

The second row is neither. Those verbs never run the root package's `preinstall`
script at all, so **there is no npm hook that can guard them**. They follow the
symlink and rewrite files inside the main checkout's dependency tree, and the
first symptom is a main checkout whose dependencies no longer match its own
lockfile — which every other worktree is linked to.

This class is **accepted and unguardable**, not covered. It is documented rather
than defended because no mechanism to defend it exists at the npm layer. Two
things bound the damage: no growspace workflow invokes these verbs — the card
declares no `postinstall` or `prepare` script and does not use `patch-package` —
and the damage is repairable by `npm ci` in the main checkout, which every
worktree's guard then re-validates against on its next setup run.

## Known gaps

Named here because they are open, not enforced:

- **The full guard runs once, at worktree setup**, and nothing re-runs it.
  Adding a dependency in the main checkout and running `npm ci` there, or a
  worktree branch changing its own lockfile, leaves that worktree testing green
  against a dependency plan matching nobody's lockfile.
  `./scripts/codex-worktree check` is incidentally covered because it re-runs
  setup before delegating. `./scripts/check card` now repeats the **cheap half**
  — the lockfile hash comparison — against whatever checkout it resolves, and
  refuses rather than re-links (hub#11, landed). The dry-run half still runs only
  at setup, so an install that stopped realizing an otherwise matching lockfile
  is caught there and nowhere else. A bare `npm test` remains uncovered; tracked
  by [card#727](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/727)
  (a card worktree refuses to test against a mismatched tree).
- ~~**The backend `.venv` has no equivalent guard.**~~ Closed by
  [ADR 0002](0002-private-backend-venvs-for-hub-managed-worktrees.md)
  ([hub#12](https://github.com/Venosta-web/growspace_manager_workspace/issues/12)),
  which reached the opposite conclusion on measurement: uv installs by
  hardlinking from a content-addressed cache, so a private backend venv costs
  ~7.9 MiB and ~0.4 s rather than the card's 465 MB, and a symlinked venv adds a
  destructive write-through class this one does not have — `uv venv --clear`
  through a link wipes the lender's environment where `npm ci` merely deletes
  the link. Hub-managed backend worktrees therefore get a private venv wherever
  the hub owns upstream's `../../.venv` hook path, and a verified shared one
  where it does not.
- **Write-through has no ticket** and will not get one; see the section above.

## Considered options

- **A private `npm ci` in every worktree** — what the card's `CLAUDE.md` claimed
  was already policy. Rejected on disk, not on time: 465 MB per worktree with no
  reflink available, against a 2.4 s install cost that is not worth optimizing.
- **Unguarded sharing** — the de-facto behaviour before this decision. Rejected:
  1 of 11 existing worktrees already carried a divergent lockfile, so the drift
  the old text feared was actually happening, invisibly.
- **The per-file symlink farm** (~24k symlinks, 3.3k directories per worktree)
  as the isolation mechanism. Rejected and removed. It isolated exactly the three
  cache directories someone anticipated; every other top-level entry stayed a
  write-through symlink, so it looked like isolation while providing it only
  where it had been hand-listed. Worktree-local cache *configuration* is the real
  boundary.
- **An npm hook enforcing read-only on the shared tree.** Rejected as impossible
  for the destructive class: those verbs never reach a root `preinstall`.
- **A copy-on-write clone per worktree** (`cp --reflink`). Unavailable: ext4.

## Consequences

- A hub-managed worktree is usable immediately after setup, at ~0.47 s of guard
  overhead and no additional disk.
- Any worktree that touches dependencies stops being hub-managed the moment it
  runs `npm ci` — that is the intended exit, and the real directory it leaves
  behind is respected on later setup runs.
- The trust window is worktree setup. Between setup runs a worktree can drift
  into testing against the wrong tree, silently and green, until the gaps above
  are closed.
- `GROWSPACE_NODE_MODULES` and farm mode are gone; there is one policy and one
  script.
- The hub, the card's `CLAUDE.md`, the card's `AGENTS.md`, and the hub's
  `AGENTS.md` now describe the same policy, and `scripts/card-node-modules`
  enforces it rather than the documents asserting it.
