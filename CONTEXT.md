# Growspace workspace hub

The hub is the development runtime the four product repositories are exercised
in, the declared fixtures that populate it, and the demo those fixtures render.
Each product repository keeps its own vocabulary; this glossary covers only the
terms the hub itself defines, and it is a glossary and nothing else — every
operating instruction stays where it already lives.

## Language

### Declared fixtures

**Capability profile**:
One coherent capability shape the fixtures exercise — tank-derived irrigation,
multi-camera vision, a faithful vendor's actuator bundle — together with the
entity inventory that shape needs. It is a declaration in the E2E entity
coverage contract, so every artifact that carries it is generated from it and
nothing may state a different shape.
_Avoid_: scenario, fixture set, entity group

**Profile instance**:
One growspace owned by a capability profile, or one install-wide fixture that
owns no growspace. A profile declares what the shape is; its instances are how
many growspaces wear it, each with its own name, entity IDs and stage.
_Avoid_: profile variant, fixture growspace, slug

**Demo Tent**:
The profile instance a demo walks a person through, carrying the generic
telemetry and simulated equipment whole rather than any vendor's faithful
hardware. It is a declared fixture and not somebody's local state: it is
provisioned, regenerated and guarded against drift with every other instance.
_Avoid_: demo instance, sample growspace, the demo data

### Simulated readings and equipment

**Waveform sensor**:
A reading derived purely from the clock, so the same instant always gives the
same value and a dashboard sees plausible, continuously moving data with
nothing driving it. Nothing can write one.
_Avoid_: fake sensor, mock sensor, random data

**Mirrored sensor**:
A reading that carries everything real hardware carries — a unit, a device
class, long-term statistics — and shows either a value written to it or its own
waveform, whichever its manual gate selects. It exists where a test must be able
to pin a reading and a dashboard must still watch it move.
_Avoid_: proxy sensor, overridable sensor, template sensor

**Simulated device**:
A piece of equipment a growspace is really configured with, whose level
free-runs on a waveform until something writes it and then holds what was
written. It is the equipment counterpart of a mirrored sensor, with the device's
own write as the gesture that trips its manual gate.
_Avoid_: fake device, mock actuator, dummy actuator

**Manual gate**:
The switch that decides whether a mirrored sensor or a simulated device reports
what last wrote it or its free-running waveform. It is off until something
writes, which is what lets an untouched fixture move on its own and a driven one
hold still.
_Avoid_: override flag, manual mode, freeze switch
