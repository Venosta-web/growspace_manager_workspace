# ADR 0003 — Demo Tent is a declared fixture, and its tissue-culture history is seeded in process

**Status:** Accepted

Decided on 2026-09-06 and 2026-09-07 in
[hub#169](https://github.com/Venosta-web/growspace_manager_workspace/issues/169)
and
[hub#171](https://github.com/Venosta-web/growspace_manager_workspace/issues/171),
landed in hub PRs #177 and #184, and recorded here in
[hub#173](https://github.com/Venosta-web/growspace_manager_workspace/issues/173).

Two decisions, one question: **where the demo lives, and who guarantees it still
works.** The demo is the one thing in this repository that is looked at rather
than asserted on, so nothing about it fails a test when it breaks. Both
decisions buy a different answer to that.

The vocabulary they turn on — Demo Tent, capability profile, profile instance,
waveform sensor, mirrored sensor, simulated device, manual gate — is defined in
[`CONTEXT.md`](../../CONTEXT.md). Mechanical detail stays in the seeding
scripts' own docstrings.

## Context

Demo Tent was hand-made. It lived in gitignored storage, it was wired to another
growspace's sensors, and it was therefore the one growspace no regeneration
reached. When the simulated equipment changed shape — from on/off switches to
free-running 0-10 `number` entities, so that a dashboard would show a moving
dial instead of a flat line — every declared profile followed and Demo Tent did
not. It was left pointing at four entity IDs that no longer existed, and nothing
said so: no generator wrote it, no drift check compared it, no spec opened it.
It was found by looking at it.

That is the failure both decisions are answers to. A fixture that *depends* on
the contract while *sitting outside* it inherits every change to the contract
and reports none of them.

The tissue-culture half of the demo has a second, unrelated version of the same
problem. A fresh install of Growspace Manager TC is functional and empty, so its
dialog opens onto "Nothing is due" — the same screen a full bench shows on a
quiet day, and the one screen a demo must not land on. Filling it needs a
*calendar*: acts recorded across the last ninety days, so that some vessels are
due and some are not. TC's own act constructor accepts the instant an act was
recorded at, but **no TC WebSocket schema exposes it and no handler passes one.**
An API-driven seed therefore stamps every act at the moment it runs, every
Replate Due Date lands at today plus its interval, and the Worklist is empty
again — the same empty screen, now with ninety days of history behind it.

## Decision 1 — `demo` is a full member of the E2E entity coverage contract

**The demo growspace is a declared capability profile like every other, with its
own entity inventory, its own generated Home Assistant package entries and its
own row in the coverage table.** CI provisions it with the rest, and the
coverage-drift refusal guards it with the rest.

It carries no faithful hardware of its own: it takes the generic telemetry and
simulated-equipment families whole, under entity IDs of its own, because a demo
wants every dashboard chip populated and moving rather than one vendor
represented exactly.

### What it costs

Measured against the contract and the dev runtime, 2026-09-07:

| what | measured |
|---|---|
| entities the contract declares for `demo` | 24 |
| entities Home Assistant then creates for the growspace itself | 14 |
| growspaces provisioned by an e2e run, with and without it | 16 / 15 |
| entity declarations in the contract, with and without it | 540 / 516 |
| card specs that assert on it | **0** |

So roughly forty more entities and one more growspace in every e2e run, for a
fixture no spec looks at. That is the whole cost, and it is paid deliberately:
sitting outside the contract while depending on it is precisely what broke Demo
Tent, and the provisioning is what makes the drift refusal mean something for
it.

### Considered options

- **Leave it hand-made in gitignored storage.** Rejected — this is the status
  quo that failed. Nothing regenerates it, so it silently keeps whatever shape
  the last person gave it while the fixtures move on underneath.
- **Keep pointing it at another profile's sensors.** Rejected for the same
  reason at one remove: two growspaces sharing one entity set is exactly what
  made the drift invisible, because the entities it displayed were real and
  someone else's.
- **Declare it, but exclude it from provisioning** — a demo-only profile the
  e2e run skips, to avoid the forty entities. Rejected: the drift refusal
  compares the generated artifacts against the declarations, so a declaration
  nothing provisions is still checked on paper and still never run. The failure
  mode being fixed is "nobody notices", and a fixture that is never brought up
  is one nobody notices.
- **A separate demo declaration, outside the coverage contract.** Rejected: it
  is a second entity inventory, which is the thing the contract exists to
  prevent, and the second inventory would be the one without a drift check —
  the original bug, reintroduced with better spelling.

### Consequences

- Every e2e run pays for a growspace no spec asserts on. That cost is now
  visible in the contract rather than hidden in someone's storage file.
- Demo Tent keeps its name, its ID, its plants and its seeded Vision evidence:
  setup adopts the existing growspace by name instead of deriving one from the
  profile slug. It is therefore the one instance outside the `E2E ` naming
  convention, so the card's focused specs hold no literal for it and the
  name-against-slug check does not apply to it.
- Its service defaults are the climate and lighting profiles' verbatim, so all
  five controllers run at tuning those profiles already test. A controller
  writing a simulated device trips that device's manual gate and the value
  becomes controller output rather than a free-running waveform — the product
  demoing itself, and a deliberate consequence rather than a side effect.
- A future change to the simulated equipment reaches Demo Tent by construction.
  That is the entire point of the forty entities.

## Decision 2 — the tissue-culture bench is seeded in process, not through the TC API

**The bench is built by importing TC's own models and repository and writing the
store directly.** The ninety-day calendar is the one thing invented; the Medium
Version a Plating pins, the Replate Due Date, what a division does to a
Culture's identity and which acts an ended vessel refuses all come from the
shipped rules, which the seed cannot diverge from without failing loudly.

The single exception is a Graduation, the only act whose data crosses back into
Growspace Manager. That half goes through Growspace Manager's public service on
the running instance, because seeded in process it would produce exactly the
state TC's error path writes when the bridge *fails*.

### Considered options

- **Seed through TC's WebSocket API.** Rejected because it cannot produce a
  calendar at all: no schema accepts the recorded instant, so every act is
  stamped today and the Worklist a demo needs to open onto stays empty.
- **Seed through the API, then rewrite the stored timestamps in a post pass.**
  Rejected. It ends in a direct write to the store regardless, so it does not
  avoid the thing it was chosen to avoid — it only adds an API round trip in
  front of it. Worse, the invariants would have been checked against today's
  clock and the clock then moved underneath them, so the resulting history is
  edited rather than produced, and nothing would have verified it is one the
  product could have reached.
- **Add `recorded_at` to the TC WebSocket schemas.** Rejected: it puts product
  code in the TC repository that exists only so this hub can seed a demo, on a
  boundary a grower's client would never send. A field that only a fixture ever
  populates is a field the product has to keep validating forever.
- **Ship a prebuilt store file.** Rejected: a fixed snapshot has a fixed
  calendar, so it is stale the day after it is written, and it is opaque to
  every rule TC enforces — the drift class this whole ADR is about, in a file
  nobody can read.

### Consequences

- The seed imports out of the TC checkout, so a change to TC's models or
  repository breaks it visibly instead of letting it write rows the product
  could not.
- It writes the persisted dictionary rather than going through the repository
  when removing what it seeded, because Maintenance Actions are append-only by
  design — a rule about the product's history, not about a demo's scaffolding.
- Home Assistant holds this state in memory and saves over the file, so seeding
  requires it down or restarted afterwards. That is a real operating
  constraint this decision creates, and the script says which of the two applies
  on the run just made.
