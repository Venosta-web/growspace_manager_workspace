# ADR 0004 — Python hooks run the worktree's own venv

**Status:** Accepted. Partly supersedes
[ADR 0002](0002-private-backend-venvs-for-hub-managed-worktrees.md).

Decided in
[hub#257](https://github.com/Venosta-web/growspace_manager_workspace/issues/257),
once
[GSM#841](https://github.com/Venosta-web/growspace_manager/issues/841) (landed on
`prerelease` in GSM PR #844, 2026-09-25) made the product repository's hooks run
the worktree's own `.venv`.
[TC#23](https://github.com/Venosta-web/growspace_manager_tc/issues/23) does the
same for Growspace Manager TC and has not landed yet. This decision does not wait
for it (see *Hook form is read per branch* below).

## Context

ADR 0002 gave every Codex-managed Python worktree a private venv and left
`scripts/feature` worktrees sharing the main checkout's. That second half was
never a preference. Upstream's hooks were declared `entry: ../../.venv/bin/pytest`,
and from `<repo>/.worktrees/<name>` that path *is* the main checkout's venv. A
private venv in the worktree would have been read by `./scripts/check` and
ignored by every commit. So the hub verified the shared venv instead and refused
when a branch's pins moved.

The refusal then offered a remedy: "refresh the shared venv from this branch's
pins". Following it rebuilt the main venv for one branch, underneath every other
worktree and the main checkout itself. That is how, on 2026-09-24, the shared venv
ended up on one branch's fpdf2 2.8.8.

GSM#841 removed the reason for sharing. Every Python hook now goes through
`.github/scripts/run_venv_tool.py`, which runs `<worktree>/.venv/bin/<tool>`,
falls back to the main checkout's venv (found through
`git rev-parse --git-common-dir`), and falls back to `PATH` for the lint tools
only. Where a worktree sits no longer decides what it runs.

## Decision

**Every hub-managed backend and TC worktree whose branch has worktree-venv hooks
runs a private venv at `<worktree>/.venv`. The main checkout's venv serves the
main checkout only.**

- **Private everywhere.** `scripts/backend-venv` builds the private venv at
  `<worktree>/.venv` in every layout: `scripts/feature`'s
  `<repo>/.worktrees/<name>` and `scripts/codex-worktree`'s
  `<pair>/<repo>/.worktrees/{backend,tc}` alike. A `.venv` link, whether to the
  main venv or to a Codex set's container venv, is unlinked and replaced. The
  build never runs `--clear` through it.
- **Fixed-path branches keep ADR 0002's behaviour.** A branch whose own
  `.pre-commit-config.yaml` still declares `entry: ../../.venv/bin/...` would
  ignore a private venv. From `scripts/feature`'s layout that branch shares the
  main venv, verified. In a Codex set it gets a private venv at the container path
  those hooks read. Both messages name the hook form as the reason.
- **The main venv matches the main checkout's pins only.** No setup path rebuilds
  it from a branch's `requirements.txt`, and no message advises it. The one
  rebuild command any message prints runs in the main checkout, against the main
  checkout's own `requirements.txt`, and only when the main venv has drifted from
  *that*.
- **`./scripts/feature env <name>`** re-runs `backend-venv` for an existing pair.
  It converts a linked worktree or rebuilds a drifted private one without
  recreating anything.
- **`./scripts/check` still only refuses.** Its drift refusal now names the setup
  that owns the venv it looked at: `feature env <name>`, `codex-worktree setup`,
  or the main checkout's own pins.

### Hook form is read per branch

The two repositories do not move together, and neither does a repository move
all at once. `growspace_manager`'s `prerelease` has worktree-venv hooks, but its
`main` and every TC branch still have fixed-path hooks. A worktree based on either
must keep working. So `backend-venv` asks the branch rather than the repository:

```
grep -Eq '^[[:space:]]*entry:[[:space:]]*\.\./\.\./\.venv/bin/' <worktree>/.pre-commit-config.yaml
```

A match means fixed-path. Anything else means worktree-venv, including a branch
with no pre-commit config. That branch runs no hooks, so its own `.venv` is the
only reader of an environment anyway. When TC#23 lands, nothing in the hub
changes: a TC branch rebased onto it gets a private venv on its next
`feature env`.

### The refusal tells two failures apart

A fixed-path `scripts/feature` worktree refuses when the main venv does not
realize the branch's `requirements.txt`. That can mean two different things, and
the old message gave both the same wrong remedy. `backend-venv` now checks the
main venv against the main checkout's own `requirements.txt` as well:

- **It realizes main's pins.** The branch is what differs. The message says the
  main venv is never rebuilt from a branch's pins, and offers two ways out: bring
  the branch onto a base with worktree-venv hooks and run `feature env`, or take
  the change on a Codex-managed set.
- **It does not.** The main venv has drifted from its own checkout. The message
  says to update the main checkout or rebuild the main venv from main's own pins,
  and prints that command with `cd <main>` in it.

### How `check` names the owner

`check` decides from the checkout's location, because that is what decides who
created it:

| checkout | refusal names |
|---|---|
| its own `git --git-common-dir` parent | the main checkout's own pins |
| `*/worktrees/codex-*/growspace_manager*/.worktrees/*` | `(cd <hub worktree> && ./scripts/codex-worktree setup)` |
| `<main>/.worktrees/<name>` | `./scripts/feature env <name>`, from the main hub checkout |
| anything else | the hub setup that created it, or its own `requirements.txt` |

When the checkout's `.venv` is a link, the refusal also says what it links to and
that other checkouts run that environment too.

## Measured during implementation

Measured on this machine on 2026-09-25, against the real `growspace_manager` with
two throwaway worktrees at `growspace_manager/.worktrees/`:

- **Worktree-venv branch (`origin/prerelease`).** `backend-venv` built a private
  venv in **1.7 s** with a warm uv cache. Running
  `PYTEST_ADDOPTS="--version --version" pre-commit run pytest --all-files --verbose`
  reported pytest, and every plugin, imported from
  `.worktrees/<name>/.venv/lib/python3.14/site-packages`. That venv has Home
  Assistant 2026.9.3; the main venv at the time had 2026.8.1.
- **Isolation.** `uv pip install cowsay` into the worktree's interpreter made
  `cowsay` importable there and not from the main venv.
- **Link conversion.** Replacing that `.venv` with a link to the main venv and
  re-running `backend-venv` restored a private venv. The main venv's Home
  Assistant version was unchanged afterwards.
- **Fixed-path branch (`origin/main`).** `backend-venv` refused. The branch pins
  fpdf2 2.8.7 and the main venv had 2.8.8. The main venv also failed against the
  main checkout's own `requirements.txt`: that checkout (on `prerelease`) pins
  Home Assistant 2026.9.3, and the venv had 2026.8.1. So the refusal reported the
  main venv as drifted from its own checkout, and printed the rebuild against
  main's pins, not the branch's.

The tooling suite, `scripts/backend-venv.test.cjs`, drives the real scripts
against a fake `uv`. In that fake, a venv realizes a requirements file only if it
was installed from one with the same content. Every install writes wherever
`--python` resolves, so an install through a link lands in the lender, as it does
for real. The suite covers both hook forms in both layouts, link conversion,
drift rebuilds, `feature env`, and each refusal's text. That includes asserting
that no refusal carries a `uv pip install` against a branch's `requirements.txt`.

## Consequences

- A `scripts/feature` worktree on a worktree-venv branch can carry a dependency
  change. That was ADR 0002's standing limitation, and it now applies only to
  fixed-path branches.
- A pin bump on one branch can no longer make `check` refuse for every other
  worktree on a worktree-venv branch.
- Each new-style worktree costs a private venv: ~7.9 MiB of unique disk and about
  2 s warm, per ADR 0002's measurements and the one above.
- Commits from the main checkout are no longer rejected by accident of the hook
  path, because the path no longer fails there. `growspace_manager` added
  `prerelease` to `no-commit-to-branch` in the same change. TC still relies on the
  accident until TC#23 lands.

## Considered options

- **Keep sharing in `scripts/feature` and only fix the message.** Rejected. It
  keeps every worktree's validation hostage to one venv. The only way to carry a
  pin change would still be to rebuild that venv or switch layout.
- **Decide by repository or by base branch instead of by the branch's config.**
  Rejected. A worktree can sit on a branch cut before GSM#841 long after
  `prerelease` moved on, and the hooks that commit will run are the ones in its
  own tree.
- **Remove a Codex set's container venv once its worktree converts.** Not done.
  After conversion nothing reads it. Flattening the Codex directory layout is a
  separate ticket, and deleting a hub-owned directory is better done there, with
  the layout it belongs to.
- **Delete a private `.venv` automatically when a worktree's branch moves back to
  fixed-path hooks.** Rejected. `backend-venv` refuses and names the directory.
  It is rebuildable, but it is also the one place someone may have installed
  something by hand.

## Known gaps

- **Fixed-path `scripts/feature` worktrees remain structurally shared.** ADR 0002's
  first gap still holds for them until their branch moves: a `pip install` there
  writes into the main venv.
- **The runner's main-venv fallback is silent.** A worktree with no `.venv` at all,
  such as a standalone `git worktree add`, still commits against the main venv.
  That fallback is upstream's decision in `run_venv_tool.py`, and `check` refuses
  such a checkout outright rather than guessing.
- **`feature env` must run from the main hub checkout.** Like `feature new`, it
  resolves the product repositories relative to the hub it runs from. So from a
  hub worktree it looks in the wrong place and says it found nothing.
