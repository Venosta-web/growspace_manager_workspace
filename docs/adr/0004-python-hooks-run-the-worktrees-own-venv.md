# ADR 0004 — Python hooks run the worktree's own venv

**Status:** Accepted. Supersedes ADR 0002's shared-venv path for
`scripts/feature` worktrees.

Decided in [hub#257](https://github.com/Venosta-web/growspace_manager_workspace/issues/257)
after [GSM#841](https://github.com/Venosta-web/growspace_manager/issues/841)
introduced `.github/scripts/run_venv_tool.py`. The fixed-path compatibility
period ended in [hub#258](https://github.com/Venosta-web/growspace_manager_workspace/issues/258)
after [TC#23](https://github.com/Venosta-web/growspace_manager_tc/issues/23)
landed and the remaining unmerged old-hook backend worktree was rebased.

## Context

The old `entry: ../../.venv/bin/pytest` hooks selected an environment by
worktree location. From `<repo>/.worktrees/<name>`, they ran the main checkout's
venv. A private `<worktree>/.venv` would have been ignored by commits even
though `./scripts/check` would inspect it. The hub therefore verified and
shared the main venv in that layout. A dependency change on one branch could
then invalidate every other worktree. Rebuilding the main venv from a branch's
pins actually caused this drift in September 2026.

The hook runner resolves tools through `<worktree>/.venv`, with a fallback to
the main checkout's venv (found via `git rev-parse --git-common-dir`) and a
`PATH` fallback for lint tools. The hub prepares the private venv before
handing over a worktree, so its hooks and checks use the same environment.

## Decision

**Every hub-managed backend and TC worktree has one venv policy: a private
`<worktree>/.venv`.** `scripts/backend-venv` applies it in both
`scripts/feature` and `scripts/codex-worktree` layouts. It replaces an existing
`.venv` symlink by unlinking it before building, and rebuilds a private venv
when it no longer realizes the branch's `requirements.txt`. It never clears a
venv through a symlink.

The worktree's own `.pre-commit-config.yaml` determines whether setup is safe.
If any hook still declares `entry: ../../.venv/bin/...`, `backend-venv`
refuses before changing an environment and instructs the user to rebase onto
a base with the hook runner. A branch without a pre-commit config has no hooks
that could ignore its private venv, so it can be prepared. The main checkout's
venv continues to serve only the main checkout and is never rebuilt from a
worktree's pins.

`./scripts/feature env <name>` reruns this setup for an existing pair. It
converts a linked worktree after its branch has the hook runner or rebuilds a
drifted private venv. `./scripts/check` remains a validator: it reports drift
and names the setup command for that worktree, without repairing anything.

### Transition completed

At removal, `./scripts/worktree-gc` showed no unmerged backend or TC worktree
with fixed-path hooks. The sole remaining candidate,
`feature/issue-711-irrigation-atomic`, rebased onto current backend
`origin/prerelease`; Git recognized its one commit as already applied upstream.
Its `.pre-commit-config.yaml` now uses `run_venv_tool.py`. The old shared
feature-worktree path and old Codex container-venv path were removed from
`backend-venv`, along with their tests. The tooling suite instead asserts that
both layouts refuse an old-hook branch without changing any venv.

### Codex sets flattened

With no hook reading `../../.venv`, the Codex set's nesting —
`<pair>/growspace_manager/.worktrees/backend`, kept only so that path landed on
a hub-owned directory — did nothing but lengthen paths. Since
[hub#259](https://github.com/Venosta-web/growspace_manager_workspace/issues/259)
`scripts/codex-worktree` puts the backend and TC worktrees at `<pair>/backend`
and `<pair>/tc`, and moves an older nested pair there with `git worktree move`,
dropping the venv that moved along because its entry points name the old path.
Migrating rather than supporting both layouts keeps one shape for every
consumer: `scripts/check`'s refusal, the override examples, and the tests.

## Consequences

- A branch can change dependencies without altering another checkout's venv.
- The main checkout's venv remains aligned to its own `requirements.txt`.
- An old-hook branch must be rebased before hub setup can prepare it.
- `uv` hardlinks from its content-addressed cache, so a private venv costs
  roughly 7.9 MiB of unique disk and about two seconds to build warm, measured
  during #257.
- The upstream runner's main-venv fallback remains possible in an unmanaged
  worktree with no `.venv`; `./scripts/check` refuses such a worktree.

## Historical options

Sharing the main venv in `scripts/feature` and placing a private venv at the
Codex container path were transition paths for fixed-path hooks. They are no
longer supported. Keeping them would make setup's result depend on layout and
could leave a worktree validating one environment while commits run another.
