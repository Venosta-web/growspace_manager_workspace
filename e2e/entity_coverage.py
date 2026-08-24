"""Single source of truth for Growspace Manager E2E entity coverage.

The declarations in this module are the seam shared by four consumers:

* the Home Assistant package generator;
* the card's growspace setup fixture;
* drift validation; and
* the coverage table in ``docs/E2E.md``.

Later simulator tickets should activate their pre-declared assignments here and
add their renderer, rather than introducing another entity inventory.
"""

from __future__ import annotations

import argparse
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
import json
from pathlib import Path
import re
from typing import Any

DOCS_BEGIN = "<!-- BEGIN GENERATED E2E ENTITY COVERAGE -->"
DOCS_END = "<!-- END GENERATED E2E ENTITY COVERAGE -->"
CARD_MANIFEST = Path("tests/e2e/fixtures/e2e-entity-coverage.generated.json")
HA_PACKAGE = Path("ha-dev/packages/e2e_simulated_sensors.yaml")
DOCS_FILE = Path("docs/E2E.md")


class Status(StrEnum):
    """Delivery state of a profile assignment."""

    COVERED = "covered"
    PLANNED = "planned"


class Behavior(StrEnum):
    """Whether a test may directly change the exposed entity's state."""

    READ_ONLY = "read-only"
    CONTROLLABLE = "controllable"


@dataclass(frozen=True)
class ProfileInstance:
    """One growspace (or global fixture) owned by a capability profile."""

    slug: str
    name: str
    plant_stage_field: str | None = None
    stage_days_ago: int = 0
    vwc_strategy: dict[str, int | float] | None = None
    service_defaults: dict[str, dict[str, Any]] | None = None


@dataclass(frozen=True)
class CapabilityProfile:
    """A coherent E2E capability shape and the instances that exercise it."""

    id: str
    description: str
    instances: tuple[ProfileInstance, ...]
    delivery_ticket: int | None = None


@dataclass(frozen=True)
class Cardinality:
    """Allowed number of entities for a role in one profile instance."""

    minimum: int
    maximum: int | None
    label: str


EXACTLY_ONE = Cardinality(1, 1, "exactly one")
ONE_OR_MORE = Cardinality(1, None, "one or more")


@dataclass(frozen=True)
class SetupReference:
    """Where setup sends an entity ID and what payload shape it uses."""

    service: str
    field: str
    shape: str = "scalar"
    member: str | None = None
    volume_liters: int | None = None


@dataclass(frozen=True)
class Assignment:
    """A role's concrete simulated entity family in one capability profile."""

    profile: str
    entity_id_rule: str
    domain: str
    behavior: Behavior
    status: Status
    count: int = 1
    delivery_ticket: int | None = None
    generator: str | None = None
    setup: SetupReference | None = None


@dataclass(frozen=True)
class Simulation:
    """Numeric metadata used by current telemetry renderers."""

    suffix: str
    unit: str
    device_class: str | None
    state_class: str
    low: int | float
    high: int | float
    period_seconds: int
    control_minimum: int | float | None = None
    control_maximum: int | float | None = None
    control_step: int | float | None = None
    control_initial: int | float | None = None


@dataclass(frozen=True)
class CoverageRole:
    """One supported integration/card entity role."""

    id: str
    category: str
    description: str
    cardinality: Cardinality
    assignments: tuple[Assignment, ...]
    simulation: Simulation | None = None


VWC_STRATEGY = {
    "target_vwc_percent": 65,
    "maintenance_dryback_percent": 3,
    "p0_duration_minutes": 60,
    "p2_stop_before_lights_off_minutes": 120,
    "shot_duration_seconds": 10,
    "shot_interval_minutes": 15,
}

LIGHTING_SERVICE_DEFAULTS: dict[str, dict[str, Any]] = {
    "configure_environment": {
        "growlight_config": {
            "enabled": True,
            "power": 65,
            "sunrise_enabled": False,
            "sunrise_minutes": 0,
        }
    },
    "set_irrigation_strategy": {
        "enabled": True,
        "auto_light_tracking": True,
        # A local wall-clock anchor is stable across restarts and does not bake
        # the generator host's UTC offset into the fixture.
        "lights_on_time": "06:00:00",
    },
}

PROFILES: tuple[CapabilityProfile, ...] = (
    CapabilityProfile(
        "stage",
        "Existing continuously simulated stage growspaces",
        (
            ProfileInstance("veg", "E2E Veg", "veg_start"),
            ProfileInstance("clone", "E2E Clone", "clone_start"),
            ProfileInstance("mother", "E2E Mother", "mother_start"),
            ProfileInstance("flower", "E2E Flower", "flower_start"),
            ProfileInstance("dry", "E2E Dry", "dry_start"),
            ProfileInstance("cure", "E2E Cure", "cure_start"),
        ),
    ),
    CapabilityProfile(
        "vwc",
        "Existing writable VWC Crop Steering growspaces",
        (
            ProfileInstance(
                "vwc_veg", "E2E VWC Veg", "veg_start", 15, dict(VWC_STRATEGY)
            ),
            ProfileInstance(
                "vwc_flower",
                "E2E VWC Flower",
                "flower_start",
                40,
                {
                    **VWC_STRATEGY,
                    "target_vwc_percent": 55,
                    "maintenance_dryback_percent": 5,
                },
            ),
        ),
    ),
    CapabilityProfile(
        "telemetry_multi",
        "Multi-sensor environmental aggregation",
        (ProfileInstance("telemetry_multi", "E2E Telemetry Multi", "veg_start"),),
        18,
    ),
    CapabilityProfile(
        "irrigation_monitored",
        "Pump-measured irrigation with flow and drain monitoring",
        (
            ProfileInstance(
                "irrigation_monitored", "E2E Irrigation Monitored", "veg_start"
            ),
        ),
    ),
    CapabilityProfile(
        "irrigation_tanks",
        "Tank-derived water tracking with multiple tanks",
        (ProfileInstance("irrigation_tanks", "E2E Irrigation Tanks", "veg_start"),),
    ),
    CapabilityProfile(
        "lighting",
        "Light-cycle sensing and plain grow-light control",
        (
            ProfileInstance(
                "lighting",
                "E2E Lighting",
                "flower_start",
                service_defaults=LIGHTING_SERVICE_DEFAULTS,
            ),
        ),
    ),
    CapabilityProfile(
        "climate_plain",
        "Plain Home Assistant climate actuator forms",
        (ProfileInstance("climate_plain", "E2E Climate Plain", "flower_start"),),
        21,
    ),
    CapabilityProfile(
        "ac_infinity",
        "Faithful AC Infinity actuator and grow-light port bundles",
        (ProfileInstance("ac_infinity", "E2E AC Infinity", "flower_start"),),
        20,
    ),
    CapabilityProfile(
        "vision",
        "Multi-camera snapshots and Vision Checkup scheduling",
        (ProfileInstance("vision", "E2E Vision", "flower_start"),),
        22,
    ),
    CapabilityProfile(
        "source_air",
        "Install-wide source-air and outdoor-condition fixtures",
        (ProfileInstance("source_air", "E2E Source Air"),),
        23,
    ),
)


def _setup(
    field: str, shape: str = "scalar", *, volume_liters: int | None = None
) -> SetupReference:
    return SetupReference(
        "configure_environment", field, shape, volume_liters=volume_liters
    )


# A mirrored sensor is a real ``sensor.*`` entity — so it carries a unit, a
# device class and a state class, and is therefore selectable, recordable and
# formattable like production hardware — whose value a test can still drive,
# because it reads a writable ``input_number``. The gate below decides which of
# the two it shows.
MIRROR_SENSOR = "mirror_sensor"
MANUAL_GATE_ROLE = "simulation.manual_telemetry"


def mirror_backing_entity_id(sensor_entity_id: str) -> str:
    """Return the writable input backing a mirrored telemetry sensor.

    One rule, applied both to declare the backing role and to render the
    template that reads it, so the two can never name different entities. It
    takes a naming *rule* as readily as a concrete ID.
    """

    return f"input_number.sim_{sensor_entity_id.split('.', 1)[1]}"


def _covered_telemetry_assignments(
    suffix: str,
    field_name: str,
    shape: str,
    *,
    include_stage: bool = True,
    include_vwc: bool = True,
) -> tuple[Assignment, ...]:
    assignments: tuple[Assignment, ...] = ()
    if include_stage:
        assignments += (
            Assignment(
                "stage",
                f"sensor.e2e_{{slug}}_{suffix}",
                "sensor",
                Behavior.READ_ONLY,
                Status.COVERED,
                generator="waveform",
                setup=_setup(field_name, shape),
            ),
        )
    if include_vwc:
        assignments += (
            Assignment(
                "vwc",
                f"input_number.e2e_{{slug}}_{suffix}",
                "input_number",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="input_number",
                setup=_setup(field_name, shape),
            ),
        )
    return assignments


def _telemetry_role(
    *,
    role_id: str,
    suffix: str,
    description: str,
    field_name: str,
    shape: str,
    unit: str,
    device_class: str | None,
    low: int | float,
    high: int | float,
    period_seconds: int,
    state_class: str = "measurement",
    multi_count: int = 1,
    category: str = "environment",
    extra_assignments: tuple[Assignment, ...] = (),
    cardinality: Cardinality | None = None,
    control_minimum: int | float | None = None,
    control_maximum: int | float | None = None,
    control_step: int | float | None = None,
    control_initial: int | float | None = None,
    include_stage: bool = True,
    include_vwc: bool = True,
    include_multi: bool = True,
) -> CoverageRole:
    multi_assignments: tuple[Assignment, ...] = ()
    if include_multi:
        multi_assignments = (
            Assignment(
                "telemetry_multi",
                f"sensor.e2e_{{slug}}_{suffix}{{ordinal_suffix}}",
                "sensor",
                Behavior.READ_ONLY,
                Status.COVERED,
                count=multi_count,
                generator=MIRROR_SENSOR,
                setup=_setup(
                    # A category with several sensors is addressed through its
                    # canonical plural field; a genuinely singular one keeps its
                    # scalar spelling, because the backend has no plural for it.
                    field_name
                    if shape != "scalar" or multi_count == 1
                    else f"{field_name}s",
                    "list" if multi_count > 1 else shape,
                ),
            ),
        )
    assignments = (
        _covered_telemetry_assignments(
            suffix,
            field_name,
            shape,
            include_stage=include_stage,
            include_vwc=include_vwc,
        )
        + multi_assignments
        + extra_assignments
    )
    return CoverageRole(
        role_id,
        category,
        description,
        cardinality
        or (ONE_OR_MORE if multi_count > 1 or shape == "list" else EXACTLY_ONE),
        assignments,
        Simulation(
            suffix,
            unit,
            device_class,
            state_class,
            low,
            high,
            period_seconds,
            control_minimum,
            control_maximum,
            control_step,
            control_initial,
        ),
    )


def _planned(
    profile: str,
    rule: str,
    domain: str,
    ticket: int,
    setup: SetupReference | None,
    *,
    count: int = 1,
    behavior: Behavior = Behavior.CONTROLLABLE,
) -> Assignment:
    return Assignment(
        profile,
        rule,
        domain,
        behavior,
        Status.PLANNED,
        count=count,
        delivery_ticket=ticket,
        setup=setup,
    )


ROLES: tuple[CoverageRole, ...] = (
    _telemetry_role(
        role_id="environment.temperature",
        suffix="temperature",
        description="Canopy air temperature",
        field_name="temperature_sensor",
        shape="scalar",
        unit="°C",
        device_class="temperature",
        low=20.0,
        high=28.0,
        period_seconds=3600,
        multi_count=2,
    ),
    _telemetry_role(
        role_id="environment.humidity",
        suffix="humidity",
        description="Canopy relative humidity",
        field_name="humidity_sensor",
        shape="scalar",
        unit="%",
        device_class="humidity",
        low=45.0,
        high=70.0,
        period_seconds=5400,
        multi_count=2,
    ),
    _telemetry_role(
        role_id="environment.vpd",
        suffix="vpd",
        description="Canopy vapor pressure deficit",
        field_name="vpd_sensor",
        shape="scalar",
        unit="kPa",
        device_class=None,
        low=0.8,
        high=1.4,
        period_seconds=3600,
        multi_count=2,
    ),
    _telemetry_role(
        role_id="environment.co2",
        suffix="co2",
        description="Carbon dioxide concentration",
        field_name="co2_sensor",
        shape="scalar",
        unit="ppm",
        device_class="carbon_dioxide",
        low=400,
        high=1200,
        period_seconds=1800,
    ),
    _telemetry_role(
        role_id="irrigation.feed_ec",
        suffix="feed_ec",
        description="Feed electrical conductivity",
        field_name="feed_ec_sensors",
        shape="list",
        unit="mS/cm",
        device_class=None,
        low=1.6,
        high=2.4,
        period_seconds=7200,
        category="irrigation",
    ),
    _telemetry_role(
        role_id="irrigation.bulk_ec",
        suffix="bulk_ec",
        description="Bulk substrate electrical conductivity",
        field_name="bulk_ec_sensors",
        shape="list",
        unit="mS/cm",
        device_class=None,
        low=1.0,
        high=3.0,
        period_seconds=7200,
        category="irrigation",
    ),
    _telemetry_role(
        role_id="irrigation.pore_ec",
        suffix="pore_ec",
        description="Pore water electrical conductivity",
        field_name="pore_ec_sensors",
        shape="list",
        unit="mS/cm",
        device_class=None,
        low=1.2,
        high=3.4,
        period_seconds=7200,
        category="irrigation",
    ),
    _telemetry_role(
        role_id="irrigation.runoff_ec",
        suffix="runoff_ec",
        description="Runoff electrical conductivity",
        field_name="runoff_ec_sensors",
        shape="list",
        unit="mS/cm",
        device_class=None,
        low=1.4,
        high=3.0,
        period_seconds=7200,
        category="irrigation",
    ),
    _telemetry_role(
        role_id="irrigation.ph",
        suffix="ph",
        description="Nutrient solution pH",
        field_name="ph_sensors",
        shape="list",
        unit="pH",
        device_class=None,
        low=5.6,
        high=6.4,
        period_seconds=9000,
        category="irrigation",
    ),
    _telemetry_role(
        role_id="environment.substrate_temperature",
        suffix="substrate_temperature",
        description="Substrate temperature",
        field_name="substrate_temperature_sensors",
        shape="list",
        unit="°C",
        device_class="temperature",
        low=18.0,
        high=24.0,
        period_seconds=5400,
        # A second probe here is what gives the card's own aggregation core a
        # plural category to average on live data — the hero metrics take a
        # different path and expose no per-sensor readings.
        multi_count=2,
    ),
    _telemetry_role(
        role_id="environment.substrate_moisture",
        suffix="substrate_moisture",
        description="Soil moisture / VWC",
        field_name="soil_moisture_sensor",
        shape="scalar",
        unit="%",
        device_class="moisture",
        low=35.0,
        high=70.0,
        period_seconds=2700,
    ),
    _telemetry_role(
        role_id="environment.power",
        suffix="power",
        description="Equipment power",
        field_name="power_sensors",
        shape="list",
        unit="W",
        device_class="power",
        low=40.0,
        high=600.0,
        period_seconds=3600,
    ),
    _telemetry_role(
        role_id="environment.energy",
        suffix="energy",
        description="Cumulative energy",
        field_name="energy_sensors",
        shape="list",
        unit="kWh",
        device_class="energy",
        low=0.0,
        high=12.0,
        period_seconds=86400,
        state_class="total_increasing",
    ),
    _telemetry_role(
        role_id="irrigation.drain_volume",
        suffix="drain_volume",
        description="Collected drain volume",
        field_name="drain_volume_sensors",
        shape="list",
        unit="L",
        device_class="volume",
        low=0.0,
        high=5.0,
        period_seconds=1800,
        category="irrigation",
        extra_assignments=(
            Assignment(
                "irrigation_monitored",
                "input_number.e2e_{slug}_drain_volume",
                "input_number",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="input_number",
                setup=_setup("drain_volume_sensors", "list"),
            ),
        ),
        control_minimum=0,
        control_maximum=100,
        control_step=0.1,
        control_initial=0,
        include_vwc=False,
        include_multi=False,
    ),
    _telemetry_role(
        role_id="irrigation.flow",
        suffix="irrigation_flow",
        description="Irrigation flow rate",
        field_name="irrigation_flow_sensors",
        shape="list",
        unit="L/min",
        device_class=None,
        low=0.0,
        high=2.0,
        period_seconds=900,
        category="irrigation",
        extra_assignments=(
            Assignment(
                "irrigation_monitored",
                "input_number.e2e_{slug}_irrigation_flow",
                "input_number",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="input_number",
                setup=_setup("irrigation_flow_sensors", "list"),
            ),
        ),
        control_minimum=0,
        control_maximum=10,
        control_step=0.01,
        control_initial=0,
        include_vwc=False,
        include_multi=False,
    ),
    _telemetry_role(
        role_id="irrigation.tank_level",
        suffix="irrigation_tank",
        description="Irrigation tank level",
        field_name="irrigation_tanks",
        shape="tank_list",
        unit="%",
        device_class=None,
        low=10.0,
        high=100.0,
        period_seconds=10800,
        category="irrigation",
        cardinality=ONE_OR_MORE,
        extra_assignments=(
            Assignment(
                "irrigation_tanks",
                "input_number.e2e_{slug}_irrigation_tank{ordinal_suffix}",
                "input_number",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                count=2,
                generator="input_number",
                setup=_setup("irrigation_tanks", "tank_list", volume_liters=50),
            ),
        ),
        control_minimum=0,
        control_maximum=100,
        control_step=1,
        control_initial=80,
        include_multi=False,
    ),
    _telemetry_role(
        role_id="environment.light",
        suffix="light",
        description="Environmental light level",
        field_name="light_sensors",
        shape="list",
        unit="lx",
        device_class="illuminance",
        low=0,
        high=60000,
        # A full day per cycle, so the pair reads as a sunrise/sunset curve and
        # the backend's "numeric light sensor above zero means lights on" rule
        # sees a plausible photoperiod.
        period_seconds=86400,
        multi_count=2,
        category="lighting",
        control_minimum=0,
        control_maximum=100000,
        control_step=1,
        include_stage=False,
        include_vwc=False,
    ),
    CoverageRole(
        "irrigation.irrigation_pump",
        "irrigation",
        "Irrigation pump actuator",
        EXACTLY_ONE,
        (
            Assignment(
                "stage",
                "switch.sim_e2e_{slug}_irrigation_pump",
                "switch",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="template_switch",
                setup=SetupReference(
                    "set_irrigation_settings", "irrigation_pump_entity"
                ),
            ),
            Assignment(
                "vwc",
                "switch.sim_e2e_{slug}_irrigation_pump",
                "switch",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="template_switch",
                setup=SetupReference(
                    "set_irrigation_settings", "irrigation_pump_entity"
                ),
            ),
            Assignment(
                "irrigation_monitored",
                "switch.sim_e2e_{slug}_irrigation_pump",
                "switch",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="template_switch",
                setup=SetupReference(
                    "set_irrigation_settings", "irrigation_pump_entity"
                ),
            ),
            Assignment(
                "irrigation_tanks",
                "switch.sim_e2e_{slug}_irrigation_pump",
                "switch",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="template_switch",
                setup=SetupReference(
                    "set_irrigation_settings", "irrigation_pump_entity"
                ),
            ),
        ),
    ),
    CoverageRole(
        "irrigation.drain_pump",
        "irrigation",
        "Drain pump actuator",
        EXACTLY_ONE,
        (
            Assignment(
                "stage",
                "switch.sim_e2e_{slug}_drain_pump",
                "switch",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="template_switch",
                setup=SetupReference("set_irrigation_settings", "drain_pump_entity"),
            ),
            Assignment(
                "vwc",
                "switch.sim_e2e_{slug}_drain_pump",
                "switch",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="template_switch",
                setup=SetupReference("set_irrigation_settings", "drain_pump_entity"),
            ),
            Assignment(
                "irrigation_monitored",
                "switch.sim_e2e_{slug}_drain_pump",
                "switch",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="template_switch",
                setup=SetupReference("set_irrigation_settings", "drain_pump_entity"),
            ),
        ),
    ),
    CoverageRole(
        "simulation.irrigation_pump_state",
        "internal",
        "Persistent backing state for an irrigation pump template switch",
        EXACTLY_ONE,
        (
            Assignment(
                "stage",
                "input_boolean.sim_e2e_{slug}_irrigation_pump",
                "input_boolean",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="input_boolean",
            ),
            Assignment(
                "vwc",
                "input_boolean.sim_e2e_{slug}_irrigation_pump",
                "input_boolean",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="input_boolean",
            ),
            Assignment(
                "irrigation_monitored",
                "input_boolean.sim_e2e_{slug}_irrigation_pump",
                "input_boolean",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="input_boolean",
            ),
            Assignment(
                "irrigation_tanks",
                "input_boolean.sim_e2e_{slug}_irrigation_pump",
                "input_boolean",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="input_boolean",
            ),
        ),
    ),
    CoverageRole(
        "simulation.drain_pump_state",
        "internal",
        "Persistent backing state for a drain pump template switch",
        EXACTLY_ONE,
        (
            Assignment(
                "stage",
                "input_boolean.sim_e2e_{slug}_drain_pump",
                "input_boolean",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="input_boolean",
            ),
            Assignment(
                "vwc",
                "input_boolean.sim_e2e_{slug}_drain_pump",
                "input_boolean",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="input_boolean",
            ),
            Assignment(
                "irrigation_monitored",
                "input_boolean.sim_e2e_{slug}_drain_pump",
                "input_boolean",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="input_boolean",
            ),
        ),
    ),
    CoverageRole(
        "lighting.state",
        "lighting",
        "Binary light-state input used by automatic cycle tracking",
        ONE_OR_MORE,
        (
            Assignment(
                "lighting",
                "binary_sensor.e2e_{slug}_light_state",
                "binary_sensor",
                Behavior.READ_ONLY,
                Status.COVERED,
                generator="aggregate_light_sensor",
                setup=_setup("light_sensors", "list"),
            ),
        ),
    ),
    CoverageRole(
        "lighting.growlight_switch",
        "lighting",
        "Plain switched grow light",
        ONE_OR_MORE,
        (
            Assignment(
                "lighting",
                "switch.e2e_{slug}_growlight_switch",
                "switch",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="template_switch",
                setup=_setup("growlight_entities", "list"),
            ),
        ),
    ),
    CoverageRole(
        "lighting.growlight_dimmable",
        "lighting",
        "Dimmable grow light",
        ONE_OR_MORE,
        (
            Assignment(
                "lighting",
                "light.e2e_{slug}_growlight_dimmable",
                "light",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="template_light",
                setup=_setup("growlight_entities", "list"),
            ),
        ),
    ),
    CoverageRole(
        "simulation.growlight_switch_state",
        "internal",
        "Persistent backing state for the plain grow light",
        EXACTLY_ONE,
        (
            Assignment(
                "lighting",
                "input_boolean.e2e_{slug}_growlight_switch",
                "input_boolean",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="input_boolean",
            ),
        ),
    ),
    CoverageRole(
        "simulation.growlight_dimmable_state",
        "internal",
        "Persistent on/off backing state for the dimmable grow light",
        EXACTLY_ONE,
        (
            Assignment(
                "lighting",
                "input_boolean.e2e_{slug}_growlight_dimmable",
                "input_boolean",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="input_boolean",
            ),
        ),
    ),
    CoverageRole(
        "simulation.growlight_dimmable_brightness",
        "internal",
        "Persistent brightness backing value for the dimmable grow light",
        EXACTLY_ONE,
        (
            Assignment(
                "lighting",
                "input_number.e2e_{slug}_growlight_dimmable_brightness",
                "input_number",
                Behavior.CONTROLLABLE,
                Status.COVERED,
                generator="brightness_input",
            ),
        ),
    ),
)


def _mirror_support_roles(roles: Sequence[CoverageRole]) -> tuple[CoverageRole, ...]:
    """Derive the internal entities every mirrored telemetry sensor needs.

    Declaring these by hand beside each telemetry role would be a second
    inventory of the first: a category added above would silently render a
    sensor that reads an ``input_number`` nobody generated. They are derived
    instead, from the same assignment that declares the mirror.
    """

    backing: list[CoverageRole] = []
    gated_profiles: list[str] = []
    for role in roles:
        for assignment in role.assignments:
            if assignment.generator != MIRROR_SENSOR or role.simulation is None:
                continue
            if assignment.profile not in gated_profiles:
                gated_profiles.append(assignment.profile)
            backing.append(
                CoverageRole(
                    f"simulation.{role.simulation.suffix}_input",
                    "internal",
                    f"Writable backing value for "
                    f"{role.description[:1].lower()}{role.description[1:]}",
                    role.cardinality,
                    (
                        Assignment(
                            assignment.profile,
                            mirror_backing_entity_id(assignment.entity_id_rule),
                            "input_number",
                            Behavior.CONTROLLABLE,
                            Status.COVERED,
                            count=assignment.count,
                            generator="input_number",
                        ),
                    ),
                    role.simulation,
                )
            )

    gates = (
        CoverageRole(
            MANUAL_GATE_ROLE,
            "internal",
            "Pins this profile's mirrored sensors to their backing values",
            EXACTLY_ONE,
            tuple(
                Assignment(
                    profile,
                    "input_boolean.sim_e2e_{slug}_manual_telemetry",
                    "input_boolean",
                    Behavior.CONTROLLABLE,
                    Status.COVERED,
                    generator="input_boolean",
                )
                for profile in gated_profiles
            ),
        ),
    )
    return tuple(backing) + (gates if gated_profiles else ())


def _plain_climate_roles() -> tuple[CoverageRole, ...]:
    specs = (
        (
            "climate.circulation_percentage",
            "fan",
            "circulation_fan_entities",
            "circulation_fan_percentage",
        ),
        (
            "climate.circulation_numeric",
            "input_number",
            "circulation_fan_entities",
            "circulation_fan_speed",
        ),
        (
            "climate.circulation_binary",
            "switch",
            "circulation_fan_entities",
            "circulation_fan_switch",
        ),
        (
            "climate.exhaust_percentage",
            "fan",
            "exhaust_fan_entities",
            "exhaust_fan_percentage",
        ),
        (
            "climate.exhaust_numeric",
            "input_number",
            "exhaust_fan_entities",
            "exhaust_fan_speed",
        ),
        (
            "climate.exhaust_binary",
            "switch",
            "exhaust_fan_entities",
            "exhaust_fan_switch",
        ),
        (
            "climate.humidifier_native",
            "humidifier",
            "humidifier_entities",
            "humidifier_native",
        ),
        (
            "climate.humidifier_switch",
            "switch",
            "humidifier_entities",
            "humidifier_switch",
        ),
        (
            "climate.dehumidifier_native",
            "humidifier",
            "dehumidifier_entities",
            "dehumidifier_native",
        ),
        (
            "climate.dehumidifier_switch",
            "switch",
            "dehumidifier_entities",
            "dehumidifier_switch",
        ),
    )
    return tuple(
        CoverageRole(
            role_id,
            "climate",
            f"Plain Home Assistant {suffix.replace('_', ' ')} form",
            ONE_OR_MORE,
            (
                _planned(
                    "climate_plain",
                    f"{domain}.e2e_{{slug}}_{suffix}",
                    domain,
                    21,
                    _setup(field_name, "list"),
                ),
            ),
        )
        for role_id, domain, field_name, suffix in specs
    )


def _ac_infinity_roles() -> tuple[CoverageRole, ...]:
    roles: list[CoverageRole] = []
    for device_role, field_name in (
        ("circulation", "circulation_fan_ac_infinity_devices"),
        ("exhaust", "exhaust_fan_ac_infinity_devices"),
        ("humidifier", "humidifier_ac_infinity_devices"),
        ("dehumidifier", "dehumidifier_ac_infinity_devices"),
    ):
        for member, domain, suffix in (
            ("mode_entity", "select", "active_mode"),
            ("speed_entity", "number", "speed"),
        ):
            roles.append(
                CoverageRole(
                    f"ac_infinity.{device_role}.{member}",
                    "ac_infinity",
                    f"AC Infinity {device_role} port {member.replace('_', ' ')}",
                    EXACTLY_ONE,
                    (
                        _planned(
                            "ac_infinity",
                            f"{domain}.e2e_{{slug}}_{device_role}_{suffix}",
                            domain,
                            20,
                            SetupReference(
                                "configure_environment", field_name, "bundle", member
                            ),
                        ),
                    ),
                )
            )

    for member, domain, suffix in (
        ("mode_entity", "select", "growlight_active_mode"),
        ("on_time_entity", "time", "growlight_on_time"),
        ("off_time_entity", "time", "growlight_off_time"),
        ("power_entity", "number", "growlight_on_power"),
        ("sunrise_switch_entity", "switch", "growlight_sunrise_enabled"),
        ("sunrise_duration_entity", "number", "growlight_sunrise_duration"),
    ):
        roles.append(
            CoverageRole(
                f"ac_infinity.growlight.{member}",
                "ac_infinity",
                f"AC Infinity grow-light {member.replace('_', ' ')}",
                EXACTLY_ONE,
                (
                    _planned(
                        "ac_infinity",
                        f"{domain}.e2e_{{slug}}_{suffix}",
                        domain,
                        20,
                        SetupReference(
                            "configure_environment",
                            "growlight_ac_infinity_devices",
                            "bundle",
                            member,
                        ),
                    ),
                ),
            )
        )
    return tuple(roles)


ROLES += _mirror_support_roles(ROLES)
ROLES += _plain_climate_roles()
ROLES += _ac_infinity_roles()
ROLES += (
    CoverageRole(
        "source_air.temperature",
        "source_air",
        "Install-wide lung-room temperature",
        EXACTLY_ONE,
        (
            _planned(
                "source_air",
                "input_number.e2e_{slug}_temperature",
                "input_number",
                23,
                SetupReference("global_settings", "lung_room_temp_sensor"),
            ),
        ),
    ),
    CoverageRole(
        "source_air.humidity",
        "source_air",
        "Install-wide lung-room humidity",
        EXACTLY_ONE,
        (
            _planned(
                "source_air",
                "input_number.e2e_{slug}_humidity",
                "input_number",
                23,
                SetupReference("global_settings", "lung_room_humidity_sensor"),
            ),
        ),
    ),
    CoverageRole(
        "source_air.weather",
        "source_air",
        "Deterministic outdoor weather conditions",
        EXACTLY_ONE,
        (
            _planned(
                "source_air",
                "weather.e2e_outdoor_conditions",
                "weather",
                23,
                SetupReference("global_settings", "weather_entity"),
                behavior=Behavior.READ_ONLY,
            ),
        ),
    ),
    CoverageRole(
        "vision.camera",
        "vision",
        "Stable camera image source",
        ONE_OR_MORE,
        (
            _planned(
                "vision",
                "camera.e2e_{slug}_{ordinal}",
                "camera",
                22,
                _setup("camera_entities", "list"),
                count=2,
                behavior=Behavior.READ_ONLY,
            ),
        ),
    ),
)


@dataclass(frozen=True)
class EntityRecord:
    """One expanded entity from one role/profile assignment."""

    entity_id: str
    role_id: str
    category: str
    profile: str
    slug: str
    domain: str
    behavior: Behavior
    status: Status
    delivery_ticket: int | None
    generator: str | None
    setup: SetupReference | None
    ordinal: int
    role: CoverageRole = field(repr=False, compare=False)
    assignment: Assignment = field(repr=False, compare=False)


def _ha_object_id(name: str) -> str:
    """The object ID Home Assistant derives from an entity's friendly name."""

    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _profile_map(profiles: Sequence[CapabilityProfile]) -> dict[str, CapabilityProfile]:
    return {profile.id: profile for profile in profiles}


def expand_entities(
    profiles: Sequence[CapabilityProfile] = PROFILES,
    roles: Sequence[CoverageRole] = ROLES,
) -> list[EntityRecord]:
    """Expand naming rules into concrete entity records."""

    profile_by_id = _profile_map(profiles)
    records: list[EntityRecord] = []
    for role in roles:
        for assignment in role.assignments:
            profile = profile_by_id.get(assignment.profile)
            if profile is None:
                continue
            for instance in profile.instances:
                for ordinal in range(1, assignment.count + 1):
                    ordinal_suffix = f"_{ordinal}" if assignment.count > 1 else ""
                    entity_id = assignment.entity_id_rule.format(
                        slug=instance.slug,
                        ordinal=ordinal,
                        ordinal_suffix=ordinal_suffix,
                    )
                    records.append(
                        EntityRecord(
                            entity_id,
                            role.id,
                            role.category,
                            profile.id,
                            instance.slug,
                            assignment.domain,
                            assignment.behavior,
                            assignment.status,
                            assignment.delivery_ticket,
                            assignment.generator,
                            assignment.setup,
                            ordinal,
                            role,
                            assignment,
                        )
                    )
    return records


def validate_contract(
    profiles: Sequence[CapabilityProfile] = PROFILES,
    roles: Sequence[CoverageRole] = ROLES,
) -> list[str]:
    """Return every declarative contract error without touching generated files."""

    errors: list[str] = []
    profile_ids = [profile.id for profile in profiles]
    duplicate_profiles = sorted({x for x in profile_ids if profile_ids.count(x) > 1})
    for profile_id in duplicate_profiles:
        errors.append(f"duplicate profile id: {profile_id}")

    role_ids = [role.id for role in roles]
    duplicate_roles = sorted({x for x in role_ids if role_ids.count(x) > 1})
    for role_id in duplicate_roles:
        errors.append(f"duplicate role id: {role_id}")

    for profile in profiles:
        for instance in profile.instances:
            # A growspace's own entities are named after the growspace, its
            # simulated sensors after this slug. When the two disagree, setup
            # waits forever for an overview sensor that Home Assistant named
            # something else — so the name is part of the contract.
            if instance.plant_stage_field is None:
                continue
            expected = f"e2e_{instance.slug}"
            actual = _ha_object_id(instance.name)
            if actual != expected:
                errors.append(
                    f"profile {profile.id} instance {instance.slug} is named "
                    f"{instance.name!r}; Home Assistant would name its overview "
                    f"sensor sensor.{actual}_overview, not sensor.{expected}_overview"
                )

    known_profiles = set(profile_ids)
    for role in roles:
        if not role.assignments:
            errors.append(f"role {role.id} has no profile assignments")
        for assignment in role.assignments:
            if assignment.profile not in known_profiles:
                errors.append(
                    f"role {role.id} references unknown profile {assignment.profile}"
                )
            if assignment.count < role.cardinality.minimum or (
                role.cardinality.maximum is not None
                and assignment.count > role.cardinality.maximum
            ):
                errors.append(
                    f"role {role.id} assignment {assignment.profile} has count "
                    f"{assignment.count}, expected {role.cardinality.label}"
                )
            if assignment.count > 1 and not (
                "{ordinal}" in assignment.entity_id_rule
                or "{ordinal_suffix}" in assignment.entity_id_rule
            ):
                errors.append(
                    f"role {role.id} assignment {assignment.profile} count > 1 "
                    "but its naming rule has no ordinal"
                )
            if (
                assignment.status is Status.PLANNED
                and assignment.delivery_ticket is None
            ):
                errors.append(
                    f"planned role {role.id} assignment {assignment.profile} has no delivery ticket"
                )

    records = expand_entities(profiles, roles)
    seen: dict[str, EntityRecord] = {}
    for record in records:
        actual_domain = record.entity_id.partition(".")[0]
        if not record.entity_id.partition(".")[1]:
            errors.append(
                f"invalid entity id for role {record.role_id}: {record.entity_id}"
            )
        elif actual_domain != record.domain:
            errors.append(
                f"domain mismatch for {record.entity_id}: role {record.role_id} "
                f"expects {record.domain}, naming rule emits {actual_domain}"
            )
        previous = seen.get(record.entity_id)
        if previous is not None:
            errors.append(
                f"duplicate entity id {record.entity_id}: "
                f"{previous.role_id}/{previous.profile} and {record.role_id}/{record.profile}"
            )
        else:
            seen[record.entity_id] = record

    gated_slugs = {
        record.slug for record in records if record.role_id == MANUAL_GATE_ROLE
    }
    for record in records:
        if record.generator != MIRROR_SENSOR:
            continue
        backing = mirror_backing_entity_id(record.entity_id)
        if backing not in seen:
            errors.append(
                f"mirrored sensor {record.entity_id} reads {backing}, "
                "which no role generates"
            )
        if record.role.simulation is None:
            errors.append(
                f"mirrored sensor {record.entity_id} has no simulation metadata "
                "to render a unit, device class or waveform from"
            )
        if record.slug not in gated_slugs:
            errors.append(
                f"mirrored sensor {record.entity_id} has no manual-telemetry "
                f"gate for {record.slug}"
            )
    return errors


def _assign_setup_value(target: dict[str, Any], record: EntityRecord) -> None:
    setup = record.setup
    if setup is None:
        return
    service = target.setdefault(setup.service, {})
    if setup.shape == "scalar":
        if setup.field in service and service[setup.field] != record.entity_id:
            raise ValueError(
                f"multiple scalar setup entities for {record.profile}/{record.slug}/{setup.field}"
            )
        service[setup.field] = record.entity_id
    elif setup.shape == "list":
        service.setdefault(setup.field, []).append(record.entity_id)
    elif setup.shape == "tank_list":
        service.setdefault(setup.field, []).append(
            {
                "name": f"Tank {record.ordinal}",
                "sensor_entity": record.entity_id,
                "volume_liters": setup.volume_liters or 50,
            }
        )
    elif setup.shape == "bundle":
        if setup.member is None:
            raise ValueError(f"bundle setup for {record.role_id} has no member")
        bundles = service.setdefault(setup.field, [{}])
        bundles[0][setup.member] = record.entity_id
    else:
        raise ValueError(f"unknown setup shape {setup.shape} for {record.role_id}")


def build_card_manifest(
    records: Sequence[EntityRecord] | None = None,
) -> dict[str, Any]:
    """Build the checked-in card setup adapter from covered assignments."""

    active = [
        record
        for record in (records or expand_entities())
        if record.status is Status.COVERED
    ]
    setup_by_instance: dict[tuple[str, str], dict[str, Any]] = {}
    for record in active:
        if record.setup is None:
            continue
        target = setup_by_instance.setdefault((record.profile, record.slug), {})
        _assign_setup_value(target, record)

    profiles: list[dict[str, Any]] = []
    for profile in PROFILES:
        for instance in profile.instances:
            services = {
                service: dict(payload)
                for service, payload in (instance.service_defaults or {}).items()
            }
            generated_services = setup_by_instance.get((profile.id, instance.slug), {})
            for service, payload in generated_services.items():
                services.setdefault(service, {}).update(payload)
            if not services:
                continue
            item: dict[str, Any] = {
                "profile": profile.id,
                "slug": instance.slug,
                "name": instance.name,
                "plant_stage_field": instance.plant_stage_field,
                "stage_days_ago": instance.stage_days_ago,
                "services": services,
            }
            if instance.vwc_strategy is not None:
                item["vwc_strategy"] = instance.vwc_strategy
            profiles.append(item)

    return {
        "generated_by": "e2e/entity_coverage.py",
        "version": 1,
        "profiles": profiles,
        "entities": [_manifest_entity(record) for record in active],
    }


def _manifest_entity(record: EntityRecord) -> dict[str, Any]:
    """One entity row for the card, carrying what a spec must assert about it.

    The unit, device class and state class travel with the entity so a card
    test can check Home Assistant's live metadata against the contract instead
    of restating it as a third inventory.
    """

    entity: dict[str, Any] = {
        "entity_id": record.entity_id,
        "role": record.role_id,
        "profile": record.profile,
        "slug": record.slug,
        "domain": record.domain,
        "behavior": record.behavior.value,
    }
    simulation = record.role.simulation
    if simulation is not None and record.generator in {MIRROR_SENSOR, "waveform"}:
        entity["unit_of_measurement"] = simulation.unit
        entity["device_class"] = simulation.device_class
        entity["state_class"] = simulation.state_class
    if record.generator == MIRROR_SENSOR:
        entity["backing_entity_id"] = mirror_backing_entity_id(record.entity_id)
    return entity


def render_card_manifest(records: Sequence[EntityRecord] | None = None) -> str:
    """Serialize the generated card setup adapter deterministically."""

    return json.dumps(build_card_manifest(records), indent=2, ensure_ascii=False) + "\n"


def validate_setup_manifest(
    manifest: dict[str, Any], generated_entity_ids: Iterable[str]
) -> list[str]:
    """Validate that every setup reference resolves to a generated entity."""

    generated = set(generated_entity_ids)
    errors: list[str] = []

    def visit(value: Any, path: str) -> None:
        if (
            isinstance(value, str)
            and "." in value
            and value.partition(".")[0]
            in {
                "sensor",
                "input_number",
                "input_boolean",
                "switch",
                "light",
                "fan",
                "humidifier",
                "binary_sensor",
                "select",
                "number",
                "time",
                "camera",
                "weather",
            }
        ):
            if value not in generated:
                errors.append(
                    f"setup reference has no generated entity at {path}: {value}"
                )
        elif isinstance(value, dict):
            for key, child in value.items():
                visit(child, f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, f"{path}[{index}]")

    for index, profile in enumerate(manifest.get("profiles", [])):
        visit(profile.get("services", {}), f"profiles[{index}].services")
    return errors


def _decimals(sim: Simulation) -> int:
    """Rounding a waveform and its writable twin must agree, or a pinned value
    would read back different from what the test wrote."""

    if sim.state_class == "total_increasing":
        return 3
    return 0 if isinstance(sim.low, int) and isinstance(sim.high, int) else 2


def _sine_expression(
    low: int | float, high: int | float, period: int, phase: int
) -> str:
    mid, amplitude = (high + low) / 2, (high - low) / 2
    decimals = 0 if isinstance(low, int) and isinstance(high, int) else 2
    return (
        "(%s + %s * sin( ((as_timestamp(now()) + %d) %% %d) / %d * 2 * pi )) "
        "| round(%d)" % (mid, amplitude, phase, period, period, decimals)
    )


def _ramp_expression(phase: int) -> str:
    return (
        "(((as_timestamp(now()) + %d) %% 86400) / 86400 * 12.0) | round(3)" % phase
    )


def _sine_state(low: int | float, high: int | float, period: int, phase: int) -> str:
    return "{{ %s }}" % _sine_expression(low, high, period, phase)


def _free_running_expression(sim: Simulation, phase: int) -> str:
    """The value a simulated sensor shows when nothing is pinning it."""

    if sim.state_class == "total_increasing":
        return _ramp_expression(phase)
    return _sine_expression(sim.low, sim.high, sim.period_seconds, phase)


def _mirror_state(sim: Simulation, backing: str, gate: str, phase: int) -> str:
    """Render a mirrored sensor's state: the pinned input, or the waveform."""

    return "{{ %s if is_state('%s', 'on') else %s }}" % (
        "states('%s') | float(0) | round(%d)" % (backing, _decimals(sim)),
        gate,
        _free_running_expression(sim, phase),
    )


def _mirror_phase(sim: Simulation, ordinal: int) -> int:
    """Offset each sensor in a category by a quarter cycle from the previous one.

    Two sensors sharing a waveform would read identically, and an aggregate of
    identical readings proves nothing about aggregation.
    """

    return (ordinal - 1) * (sim.period_seconds // 4)


def _telemetry_label(record: EntityRecord) -> str:
    """Friendly name for one simulated telemetry entity.

    Categories with more than one sensor carry the ordinal, so two readings of
    the same thing stay distinguishable wherever Home Assistant shows names
    rather than entity IDs.
    """

    simulation = record.role.simulation
    assert simulation is not None
    ordinal = f" {record.ordinal}" if record.assignment.count > 1 else ""
    return f"e2e {record.slug} {simulation.suffix}{ordinal}"


def _template_sensor_lines(record: EntityRecord, name: str) -> list[str]:
    """Render everything a template sensor declares above its state."""

    sim = record.role.simulation
    assert sim is not None
    lines = [
        f"      - name: {name}",
        f"        unique_id: {record.entity_id.split('.', 1)[1]}",
        f'        unit_of_measurement: "{sim.unit}"',
    ]
    if sim.device_class:
        lines.append(f"        device_class: {sim.device_class}")
    lines += [f"        state_class: {sim.state_class}", "        state: >-"]
    return lines


def _mirror_template_lines(
    active: Sequence[EntityRecord], by_slug: dict[str, list[EntityRecord]]
) -> list[str]:
    """Render one trigger-template block per profile that mirrors its inputs.

    The block re-renders every half minute so an unpinned dashboard keeps
    moving, and on any write to a backing input or to the gate so a pinned
    value lands immediately instead of up to 30 s later.
    """

    gate_by_slug = {
        record.slug: record.entity_id
        for record in active
        if record.role_id == MANUAL_GATE_ROLE
    }
    lines: list[str] = []
    for profile in PROFILES:
        for instance in profile.instances:
            mirrors = [
                record
                for record in by_slug.get(instance.slug, [])
                if record.generator == MIRROR_SENSOR
            ]
            if not mirrors:
                continue
            gate = gate_by_slug[instance.slug]
            backings = [mirror_backing_entity_id(m.entity_id) for m in mirrors]
            lines += [
                "  # ---------------------------------------------------------------",
                f"  # e2e_{instance.slug} — every reading mirrors a writable input",
                "  # ---------------------------------------------------------------",
                "  - trigger:",
                "      - platform: time_pattern",
                '        seconds: "/30"',
                "      - platform: state",
                "        entity_id:",
                f"          - {gate}",
            ]
            lines += [f"          - {backing}" for backing in backings]
            lines.append("    sensor:")
            for record, backing in zip(mirrors, backings, strict=True):
                sim = record.role.simulation
                assert sim is not None
                lines += _template_sensor_lines(record, _telemetry_label(record))
                lines.append(
                    "          "
                    + _mirror_state(
                        sim, backing, gate, _mirror_phase(sim, record.ordinal)
                    )
                )
    return lines


def render_ha_package(records: Sequence[EntityRecord] | None = None) -> str:
    """Render the existing HA package from covered contract assignments."""

    active = [
        record
        for record in (records or expand_entities())
        if record.status is Status.COVERED
    ]
    by_slug: dict[str, list[EntityRecord]] = {}
    for record in active:
        by_slug.setdefault(record.slug, []).append(record)

    lines = [
        "# GENERATED by e2e/entity_coverage.py — do not edit by hand.",
        "# Simulated entities backing the e2e capability profiles.",
        "",
        "template:",
    ]
    stage = next(profile for profile in PROFILES if profile.id == "stage")
    for index, instance in enumerate(stage.instances):
        phase = index * 600
        lines += [
            "  # ---------------------------------------------------------------",
            f"  # e2e_{instance.slug}",
            "  # ---------------------------------------------------------------",
            "  - trigger:",
            "      - platform: time_pattern",
            '        seconds: "/30"',
            "    sensor:",
        ]
        telemetry = [
            record
            for record in by_slug[instance.slug]
            if record.generator == "waveform" and record.role.simulation is not None
        ]
        telemetry.sort(
            key=lambda record: record.role.simulation.state_class == "total_increasing"
        )
        for record in telemetry:
            sim = record.role.simulation
            lines += _template_sensor_lines(record, _telemetry_label(record))
            lines.append(f"          {{{{ {_free_running_expression(sim, phase)} }}}}")

    lines += _mirror_template_lines(active, by_slug)

    instance_order = {
        instance.slug: index
        for index, instance in enumerate(
            instance for profile in PROFILES for instance in profile.instances
        )
    }
    switches = [
        record for record in active if record.generator == "template_switch"
    ]
    switches.sort(
        key=lambda record: (
            instance_order[record.slug],
            record.role_id == "irrigation.drain_pump",
        )
    )
    lines += [
        "  # ---------------------------------------------------------------",
        "  # plain switches (toggleable, state backed by input_boolean)",
        "  # ---------------------------------------------------------------",
        "  - switch:",
    ]
    for record in switches:
        unique_id = record.entity_id.split(".", 1)[1]
        backing = f"input_boolean.{unique_id}"
        if record.role_id.startswith("irrigation."):
            kind = unique_id.rsplit("_", 2)[-2] + "_pump"
            name = f"sim e2e {record.slug} {kind}"
        else:
            name = unique_id.replace("_", " ")
        lines += [
            f"      - name: {name}",
            f"        unique_id: {unique_id}",
            f"        state: \"{{{{ is_state('{backing}', 'on') }}}}\"",
            "        turn_on:",
            "          action: input_boolean.turn_on",
            "          target:",
            f"            entity_id: {backing}",
            "        turn_off:",
            "          action: input_boolean.turn_off",
            "          target:",
            f"            entity_id: {backing}",
        ]

    binary_light_sensors = [
        record for record in active if record.generator == "aggregate_light_sensor"
    ]
    if binary_light_sensors:
        lines += [
            "  # ---------------------------------------------------------------",
            "  # aggregate light-state sensors used by automatic cycle tracking",
            "  # ---------------------------------------------------------------",
            "  - binary_sensor:",
        ]
    for record in binary_light_sensors:
        unique_id = record.entity_id.split(".", 1)[1]
        actuators = [
            candidate.entity_id
            for candidate in by_slug[record.slug]
            if candidate.role_id
            in {"lighting.growlight_switch", "lighting.growlight_dimmable"}
        ]
        state = " or ".join(
            f"is_state('{entity_id}', 'on')" for entity_id in actuators
        )
        lines += [
            f"      - name: {unique_id.replace('_', ' ')}",
            f"        unique_id: {unique_id}",
            "        device_class: light",
            f'        state: "{{{{ {state} }}}}"',
        ]

    dimmable_lights = [
        record for record in active if record.generator == "template_light"
    ]
    if dimmable_lights:
        lines += [
            "  # ---------------------------------------------------------------",
            "  # dimmable lights (state and level backed by helpers)",
            "  # ---------------------------------------------------------------",
            "  - light:",
        ]
    for record in dimmable_lights:
        unique_id = record.entity_id.split(".", 1)[1]
        state_backing = f"input_boolean.{unique_id}"
        level_backing = f"input_number.{unique_id}_brightness"
        lines += [
            f"      - name: {unique_id.replace('_', ' ')}",
            f"        unique_id: {unique_id}",
            f"        state: \"{{{{ is_state('{state_backing}', 'on') }}}}\"",
            f"        level: \"{{{{ states('{level_backing}') | int(128) }}}}\"",
            "        turn_on:",
            "          action: input_boolean.turn_on",
            "          target:",
            f"            entity_id: {state_backing}",
            "        turn_off:",
            "          action: input_boolean.turn_off",
            "          target:",
            f"            entity_id: {state_backing}",
            "        set_level:",
            "          - action: input_number.set_value",
            "            target:",
            f"              entity_id: {level_backing}",
            "            data:",
            '              value: "{{ brightness }}"',
            "          - action: input_boolean.turn_on",
            "            target:",
            f"              entity_id: {state_backing}",
        ]

    lines += ["", "input_boolean:"]
    boolean_backings = [
        record for record in active if record.generator == "input_boolean"
    ]
    for record in boolean_backings:
        object_id = record.entity_id.split(".", 1)[1]
        if record.role_id.startswith("simulation.") and object_id.startswith(
            "sim_e2e_"
        ):
            kind = object_id.rsplit("_", 2)[-2] + "_pump"
            name = f"sim e2e {record.slug} {kind}"
        else:
            name = object_id.replace("_", " ")
        lines += [
            f"  {object_id}:",
            f"    name: {name}",
            "    initial: false",
        ]
    lines += ["", "input_number:"]
    for instance in (
        instance for profile in PROFILES for instance in profile.instances
    ):
        telemetry = [
            record
            for record in by_slug.get(instance.slug, [])
            if record.generator == "input_number" and record.role.simulation is not None
        ]
        telemetry.sort(
            key=lambda record: record.role.simulation.state_class == "total_increasing"
        )
        for record in telemetry:
            sim = record.role.simulation
            object_id = record.entity_id.split(".", 1)[1]
            if sim.state_class == "total_increasing":
                minimum, maximum, step, initial = 0, 100000, 0.001, 5.0
            else:
                minimum = (
                    sim.control_minimum
                    if sim.control_minimum is not None
                    else min(0, sim.low)
                )
                maximum = (
                    sim.control_maximum
                    if sim.control_maximum is not None
                    else sim.high * 2
                )
                step = sim.control_step if sim.control_step is not None else 0.01
                initial = (
                    sim.control_initial
                    if sim.control_initial is not None
                    # Spread the starting values across the range so a category's
                    # sensors differ before a test writes anything. With one
                    # sensor this is the midpoint.
                    else round(
                        sim.low
                        + (sim.high - sim.low)
                        * record.ordinal
                        / (record.assignment.count + 1),
                        2,
                    )
                )
            label = _telemetry_label(record)
            if object_id.startswith("sim_"):
                label = f"sim {label}"
            lines += [
                f"  {object_id}:",
                f"    name: {label}",
                f"    min: {minimum}",
                f"    max: {maximum}",
                f"    step: {step}",
                f"    initial: {initial}",
                f'    unit_of_measurement: "{sim.unit}"',
                "    mode: box",
            ]
    for record in active:
        if record.generator != "brightness_input":
            continue
        object_id = record.entity_id.split(".", 1)[1]
        lines += [
            f"  {object_id}:",
            f"    name: {object_id.replace('_', ' ')}",
            "    min: 0",
            "    max: 255",
            "    step: 1",
            "    initial: 128",
            "    mode: slider",
        ]
    return "\n".join(lines) + "\n"


def extract_generated_entity_ids(package_text: str) -> list[str]:
    """Extract entity IDs from the deterministic package format."""

    ids: list[str] = []
    section: str | None = None
    template_domain: str | None = None
    for line in package_text.splitlines():
        if line and not line.startswith(" ") and line.endswith(":"):
            section = line[:-1]
            template_domain = None
            continue
        stripped = line.strip()
        if section == "template":
            if stripped == "sensor:":
                template_domain = "sensor"
            elif stripped in {"- switch:", "- binary_sensor:", "- light:"}:
                template_domain = stripped.removeprefix("- ").removesuffix(":")
            elif stripped.startswith("unique_id:") and template_domain:
                ids.append(f"{template_domain}.{stripped.split(':', 1)[1].strip()}")
        elif section in {"input_boolean", "input_number"}:
            match = re.fullmatch(r"  ([a-z0-9_]+):", line)
            if match:
                ids.append(f"{section}.{match.group(1)}")
    return ids


def validate_generated_entities(
    generated_entity_ids: Sequence[str], records: Sequence[EntityRecord] | None = None
) -> list[str]:
    """Compare actual generated IDs with covered declarations."""

    expected_records = [
        record
        for record in (records or expand_entities())
        if record.status is Status.COVERED
    ]
    expected = {record.entity_id: record for record in expected_records}
    errors: list[str] = []
    seen: set[str] = set()
    for entity_id in generated_entity_ids:
        if entity_id in seen:
            errors.append(f"generated duplicate entity id: {entity_id}")
        seen.add(entity_id)
        record = expected.get(entity_id)
        if record is None:
            errors.append(f"generated entity has no declared covered role: {entity_id}")
            continue
        actual_domain = entity_id.partition(".")[0]
        if actual_domain != record.domain:
            errors.append(
                f"generated domain mismatch for {entity_id}: role {record.role_id} expects {record.domain}"
            )
    for entity_id, record in expected.items():
        if entity_id not in seen:
            errors.append(
                f"covered role {record.role_id}/{record.profile} has no generated entity: {entity_id}"
            )
    return errors


def render_docs_section() -> str:
    """Render the contract-derived E2E coverage matrix."""

    lines = [
        DOCS_BEGIN,
        "<!-- Regenerate with ./scripts/gen-e2e-sensors; do not edit this table. -->",
        "",
        "| Role | Category | Capability profile | Entity naming rule | Domain | Cardinality | Behavior | Delivery |",
        "|---|---|---|---|---|---|---|---|",
    ]
    profiles = _profile_map(PROFILES)
    for role in ROLES:
        for assignment in role.assignments:
            profile = profiles[assignment.profile]
            slugs = ", ".join(instance.slug for instance in profile.instances)
            profile_label = f"`{profile.id}` ({slugs})"
            delivery = (
                "covered"
                if assignment.status is Status.COVERED
                else f"planned in [#{assignment.delivery_ticket}](https://github.com/Venosta-web/growspace_manager_workspace/issues/{assignment.delivery_ticket})"
            )
            lines.append(
                "| `{}` | {} | {} | `{}` | `{}` | {} ({}) | {} | {} |".format(
                    role.id,
                    role.category,
                    profile_label,
                    assignment.entity_id_rule,
                    assignment.domain,
                    role.cardinality.label,
                    assignment.count,
                    assignment.behavior.value,
                    delivery,
                )
            )
    lines += ["", DOCS_END]
    return "\n".join(lines)


def replace_docs_section(document: str, section: str | None = None) -> str:
    """Replace the marked generated docs section."""

    generated = section or render_docs_section()
    pattern = re.compile(rf"{re.escape(DOCS_BEGIN)}.*?{re.escape(DOCS_END)}", re.DOTALL)
    if not pattern.search(document):
        raise ValueError(f"{DOCS_FILE} is missing generated coverage markers")
    return pattern.sub(generated, document)


def _resolve_card_root(workspace: Path, value: str | None) -> Path:
    if value:
        return Path(value).resolve()
    return (workspace.parent / "lovelace-growspace-manager-card").resolve()


def _output_map(workspace: Path, card_root: Path) -> dict[Path, str]:
    docs_path = workspace / DOCS_FILE
    docs = replace_docs_section(docs_path.read_text())
    return {
        workspace / HA_PACKAGE: render_ha_package(),
        card_root / CARD_MANIFEST: render_card_manifest(),
        docs_path: docs,
    }


def validate_outputs(workspace: Path, card_root: Path) -> list[str]:
    """Validate the contract and every generated adapter in the workspace."""

    errors = validate_contract()
    if errors:
        return errors
    outputs = _output_map(workspace, card_root)
    for path, expected in outputs.items():
        if not path.exists():
            errors.append(f"missing generated output: {path}")
        elif path.read_text() != expected:
            errors.append(f"generated output is stale: {path}")

    package_path = workspace / HA_PACKAGE
    if package_path.exists():
        generated_ids = extract_generated_entity_ids(package_path.read_text())
        errors.extend(validate_generated_entities(generated_ids))
    else:
        generated_ids = []

    manifest_path = card_root / CARD_MANIFEST
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text())
        except json.JSONDecodeError as err:
            errors.append(f"invalid generated setup manifest {manifest_path}: {err}")
        else:
            errors.extend(validate_setup_manifest(manifest, generated_ids))
    return errors


def generate_outputs(workspace: Path, card_root: Path) -> None:
    """Write every derived adapter after validating the declarations."""

    errors = validate_contract()
    if errors:
        raise ValueError("\n".join(errors))
    for path, content in _output_map(workspace, card_root).items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)


def _summary() -> str:
    records = expand_entities()
    covered = [record for record in records if record.status is Status.COVERED]
    return (
        f"{len(ROLES)} roles declared; {len(covered)} covered entities; "
        f"{len(records) - len(covered)} planned entities"
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("generate", "check"))
    parser.add_argument(
        "--workspace", default=str(Path(__file__).resolve().parent.parent)
    )
    parser.add_argument("--card-root")
    args = parser.parse_args(argv)
    workspace = Path(args.workspace).resolve()
    card_root = _resolve_card_root(workspace, args.card_root)

    if args.mode == "generate":
        generate_outputs(workspace, card_root)
        print(f"  wrote {HA_PACKAGE}")
        print(f"  wrote {card_root / CARD_MANIFEST}")
        print(f"  updated {DOCS_FILE}")
        print(f"  {_summary()}")
        return 0

    errors = validate_outputs(workspace, card_root)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print(f"E2E entity coverage contract is consistent ({_summary()})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
