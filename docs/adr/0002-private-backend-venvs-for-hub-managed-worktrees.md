# ADR 0002 — Hub-managed backend worktrees do not share the main checkout's venv

**Status:** Accepted

Decided and measured on 2026-08-23 in
[hub#12](https://github.com/Venosta-web/growspace_manager_workspace/issues/12),
the backend half of the pair opened by
[card#706](https://github.com/Venosta-web/lovelace-growspace-manager-card/issues/706).
It reverses, for the backend, the sharing decision
[ADR 0001](0001-guarded-shared-card-dependencies.md) reached for the card — on
measurements, not symmetry.

## Context

[ADR 0001](0001-guarded-shared-card-dependencies.md) left the backend `.venv` as
a named open gap: "The same reasoning applies to the single shared venv, which
this decision never covered." The asymmetry ran the wrong way. The case that had
been investigated and measured — the card's `node_modules` — failed closed, and
the one nobody had looked at did not. A backend branch that changed its pins was
silently tested against the main checkout's environment.

The issue's premise needs one correction before the rest follows. It says both
entry points "symlink `.venv` unconditionally". Only `scripts/codex-worktree`
created a symlink. `scripts/feature` created none and did not need to: its
worktrees live at `growspace_manager/.worktrees/<name>`, from which upstream's
hook path `../../.venv` *is* the main checkout's venv. Same sharing, same
absence of a guard, different mechanism — and the difference turns out to decide
the design, because a symlink can be redirected and a relative path cannot.

Which environment a backend worktree runs is not the hub's choice. Upstream
declares its pre-commit hooks as `entry: ../../.venv/bin/pytest`, so the answer
is always `<worktree>/../../.venv`, and where the worktree sits decides who owns
that path:

| layout | `../../.venv` resolves to | owner |
|---|---|---|
| `growspace_manager/.worktrees/<name>` (`scripts/feature`) | `growspace_manager/.venv` | the main checkout |
| `<pair>/growspace_manager/.worktrees/backend` (`scripts/codex-worktree`) | `<pair>/growspace_manager/.venv` | the hub |

## Measurements

All from this machine, 2026-08-23. `~/dev` is ext4.

### 1. How often do backend pins actually change?

Commits touching `requirements.txt` reachable from `origin/prerelease`:

| window | changes |
|---|---|
| 30 days | 3 |
| 90 days | 5 |
| 180 days | 10 |
| 365 days | 36 |

`pyproject.toml` moved seven times in 180 days, but only two of those commits
(`f0ba43b`, `97a8040`, both 2026-05-10) touched a version pin; the rest are
tooling configuration. `requirements.txt` is the file that decides what the venv
contains.

Five changes in 90 days is **2.5× the card's rate** — ADR 0001 measured two
lockfile changes in 90 days and used that rarity to argue guarded sharing was
the common path rather than a constant nuisance. Here the argument is weaker to
begin with.

### 2. What does a private venv actually cost?

`uv` installs by hardlinking out of a content-addressed cache, and `~/.cache/uv`
sits on the same filesystem as `~/dev`. This is the copy-on-write clone ADR 0001
went looking for and could not have — `cp --reflink` is unavailable on ext4, but
hardlinks are not.

| what | measured |
|---|---|
| main checkout's `.venv`, as `du` reports it | 791 MB apparent / 1009 MB on disk |
| cold private venv, empty uv cache | **6.3 s**, populating an 869 MB cache |
| warm private venv | **0.36 s** |
| warm private venv, additional disk (`df` delta) | **0 MiB** |
| warm private venv, files not hardlinked | **523 files, 6.5 MiB** |
| four concurrent warm builds against one cache | 0.41 s wall, 4/4 succeeded |
| verifying an existing venv | **~0.1 s** |

`du -sh` reports 769 MB for a private venv and is misleading: 63,784 of its
64,307 site-package files have `nlink=3`. The honest number is the last column —
**a private backend venv costs about 7.9 MiB of unique disk and a third of a
second.**

The concurrency row is there because ADR 0001 found the opposite for the card:
4 of 10 concurrent worktree pairs hung on a shared Vite optimiser cache. uv's
cache is built for concurrent readers and locks accordingly; four simultaneous
builds against one cache all succeeded. The card's cache finding does not
generalize to this one.

(The main checkout's own `.venv` has `nlink=1` throughout — it was built by pip,
so it shares nothing with the uv cache. Rebuilding it with uv would.)

### 3. Is there a `npm ci --dry-run --offline` equivalent?

Yes, and a better one:

```
uv pip install --python <venv>/bin/python --dry-run --offline \
  -r requirements.txt -c <homeassistant package_constraints.txt>
```

It prints `Would make no changes` in ~0.1 s when the environment satisfies the
declared requirements, and fails otherwise, naming the requirement that is unmet.

It is better than npm's because it is **semantic rather than textual**. npm
compares a lockfile byte-for-byte and then confirms the install realizes it, so
loosening a constraint reads as drift. This asks only whether the installed
versions satisfy what the branch declares: changing `mashumaro==3.22` to
`==3.21` fails, relaxing it to a bare `mashumaro` passes. That is the question
worth asking, so there is no reason to also compare `requirements.txt` hashes,
and this ADR does not.

Two details matter for anyone reading the implementation. The constraints file
is included because the venv is *built* under it (the backend's `CLAUDE.md`
two-phase install), and checking without it asks a looser question than the
install answered. And exit status alone is not the verdict: a cache hit lets uv
exit 0 while still planning an install, so the guard requires the phrase.

### 4. Write-through, measured rather than assumed

ADR 0001 measured that `npm ci` **deletes the link** and leaves the lender's tree
untouched, which is what makes an accidental conversion to a private install
recoverable. The issue asked whether the same holds for Python. It does not.
Against a `.venv` symlinked to a lender venv:

| verb | effect on the link | effect on the lender's venv |
|---|---|---|
| `uv pip install X` | intact | **written through** — package appears in the lender |
| `python -m pip install X` | intact | **written through** |
| `python -m pip uninstall X` | intact | **written through** — package removed from the lender |
| `uv venv <path>` | intact | refused: "A virtual environment already exists" |
| `uv venv --clear <path>` | intact | **destroyed** — site-packages went 360 entries → 2 |

The last row is the one that matters. `uv venv --clear` is the documented
recovery command in the backend's `CLAUDE.md`, and through a symlink it does not
convert the worktree to a private environment the way `npm ci` does — it wipes
the environment every other worktree is running. Python has no verb that
replaces the link instead of following it: pip and uv both resolve the
interpreter's real `sys.prefix` and write there. **Every environment-mutating
verb writes through, including the repair.**

## Decision

**A hub-managed backend worktree gets a private venv wherever the hub owns the
`../../.venv` path, and a verified shared one where it does not. Either way the
environment is checked to realize that worktree's own `requirements.txt` before
the worktree is handed over.** `scripts/backend-venv` is the one implementation;
both setup paths call it.

Concretely:

- **`scripts/codex-worktree`** — the hub owns `<pair>/growspace_manager/.venv`,
  so that path becomes a **real private venv**, replacing the symlink it used to
  create. Drift cannot arise, and `uv venv --clear` can only destroy the pair's
  own environment.
- **`scripts/feature`** — `../../.venv` *is* `growspace_manager/.venv`. There is
  no link to redirect, and a private venv inside the worktree would be a decoy
  nothing reads. So the shared venv is **verified and the setup refuses** if it
  does not realize the branch's `requirements.txt`. The refusal explains that
  rebuilding the shared venv is a decision about every other worktree, and
  offers a Codex-managed pair as the alternative for a pin change.
- Both paths then point the worktree's own `.venv` at whichever environment the
  hooks will use, so `./scripts/check backend` and pre-commit cannot disagree
  about what is being run. `scripts/feature` worktrees previously had no `.venv`
  at all, which made `GROWSPACE_BACKEND=<worktree> ./scripts/check backend`
  fail outright.
- **`./scripts/check backend`** re-runs the verification against whatever
  checkout it resolved, refusing rather than repairing.

The ownership boundary from ADR 0001 carries over unchanged: **setup heals,
validation refuses.** `scripts/backend-venv` may build and rebuild a venv at a
path the hub owns; `scripts/check` only ever compares and stops.

### Why this differs from the card, in one line

The card shares because a private `node_modules` costs 465 MB × N on a
filesystem that cannot share blocks. The backend does not, because uv's
hardlinked cache makes a private venv cost 7.9 MiB — and because a shared venv
carries a destructive write-through class npm's link does not have.

### Why `./scripts/check` runs the whole guard here

ADR 0001 splits the card's guard: `./scripts/check card` repeats only the cheap
lockfile hash, leaving the `npm ci --dry-run` half at setup. There is nothing to
split here. The semantic check *is* the cheap half — ~0.1 s, against ~0.47 s for
the card's two-layer guard — so `./scripts/check backend` runs the complete
thing on every invocation.

## Consequences

- A Codex-managed pair no longer shares an environment with the main checkout.
  Setup costs ~0.4 s and ~7.9 MiB more than the symlink it replaces, and re-runs
  cost ~0.16 s once the venv exists.
- Existing Codex pairs converge on the next `setup`: an existing `.venv` symlink
  is replaced by a private venv.
- The first build on a machine with a cold uv cache costs ~6.3 s and ~870 MB of
  cache, once, shared by every later worktree. It needs network. If it fails,
  setup fails rather than falling back to sharing.
- `./scripts/check backend` now refuses on an environment that does not realize
  `requirements.txt` — including in the main checkout, where it catches "the
  pins moved and nobody rebuilt", the failure ADR-0020's 2026-08-07 amendment
  describes.
- A `scripts/feature` pair still cannot carry a backend dependency change. That
  is a property of upstream's hook path, not of this decision; the refusal names
  it and points at the pair layout that can.

## Considered options

- **Guarded sharing, mirroring ADR 0001.** Rejected. It preserves the
  `uv venv --clear` footgun for no saving: the thing sharing would buy is 7.9 MiB.
- **A private venv in every worktree, including `scripts/feature`'s.** Rejected.
  From `growspace_manager/.worktrees/<name>` the hooks read
  `growspace_manager/.venv`, so a private venv there would be read by
  `./scripts/check` and ignored by every commit — two environments, one guarded.
  Worse than the honest refusal.
- **Relocating `scripts/feature`'s worktrees** so the hub owns their hook path
  too. Rejected as out of scope: the location is upstream's constraint, restated
  in this hub's `AGENTS.md`, and moving it to win 7.9 MiB of consistency is not
  a trade worth making here.
- **Hashing `requirements.txt` between checkouts**, the direct analogue of the
  card's lockfile comparison. Rejected as strictly worse than the semantic
  check: it costs the same order of time and reports false drift whenever a
  branch loosens a pin.
- **An `uv venv --clear` guard.** Not attempted. Once the hub-owned path holds a
  real venv there is nothing to guard, and where the path is the main checkout's
  venv, clearing it is a legitimate rebuild rather than an accident.

## Known gaps

- **`scripts/feature` worktrees remain structurally shared.** Verified at setup
  and on every `./scripts/check backend`, but a `uv pip install` run by hand in
  one of them still writes into the environment every other worktree runs. That
  is the same accepted, unguardable class ADR 0001 documents for the card, and
  here it is worse: it needs no symlink to happen, because the shared venv is
  simply the venv.
- **The guard covers `./scripts/check`, not a bare `pytest`.** Running
  `../../.venv/bin/pytest tests/ -q` directly skips it, exactly as a bare
  `npm test` skips the card's.
