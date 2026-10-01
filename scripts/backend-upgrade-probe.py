"""Execute pure irrigation decisions using the HACS-installed release.

The host passes its persisted document on stdin. This process imports the
installed component, but reads no runtime files and operates no pumps.
"""

import json
import sys
from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta
from enum import Enum

# HA normally supplies this import root; a standalone process needs it too.
sys.path.insert(0, "/config")

from custom_components.growspace_manager.domain.infiltration import InfiltrationState
from custom_components.growspace_manager.domain.pump_cycle import (
    cycle_volume_liters,
    decide_cycle,
)
from custom_components.growspace_manager.domain.steering_phase import (
    SteeringPhaseMachine,
    SteeringTickInputs,
    resolve_day_hours,
)
from custom_components.growspace_manager.models import (
    EnvironmentConfig,
    Growspace,
    IrrigationConfig,
    IrrigationStrategy,
)


def tick_verdicts(document):
    """Replay a fixed day and the schedule gate, with both fire and hold cases."""
    contract = None
    if "irrigation_zones" in document:
        from custom_components.growspace_manager.domain.irrigation_zone import (
            LIGHT_CYCLE_FIELDS,
            ZONE_CONFIG_FIELDS,
            ZONE_ENVIRONMENT_FIELDS,
            effective_config,
            effective_strategy,
            zone_integrity_problems,
        )

        growspace = Growspace.from_dict(document)
        config = effective_config(growspace)
        strategy = effective_strategy(growspace)
        environment = growspace.environment_config
        contract = {
            "config_fields": ZONE_CONFIG_FIELDS,
            "environment_fields": ZONE_ENVIRONMENT_FIELDS,
            "light_fields": LIGHT_CYCLE_FIELDS,
            "problems": zone_integrity_problems(document),
        }
    else:
        config = IrrigationConfig.from_dict(document["irrigation_config"])
        strategy = IrrigationStrategy.from_dict(document["irrigation_strategy"])
        environment = EnvironmentConfig.from_dict(document["environment_config"])
    machine = SteeringPhaseMachine("release-check")
    start = datetime(2026, 9, 21, tzinfo=UTC)
    steering = []
    last_shot = None
    for minute in range(0, 24 * 60, 5):
        now = start + timedelta(minutes=minute)
        verdict = machine.tick(
            SteeringTickInputs(
                now=now,
                vwc=44.0 + (minute % 180) / 15,
                strategy=strategy,
                auto_advance_p2_to_p3=config.auto_advance_p2_to_p3,
                soil_trigger_percent=config.soil_trigger_percent,
                pump_flow_rate_ml_per_sec=config.pump_flow_rate_ml_per_sec,
                pump_configured=bool(config.irrigation_pump_entity),
                day_hours=resolve_day_hours(environment),
                live_plant_count=2,
                last_shot=last_shot,
                interval_factor=1.0,
                infiltration=InfiltrationState.SETTLED,
            )
        )
        if verdict.fire is not None:
            last_shot = now
        steering.append(asdict(verdict))
    schedule = [
        asdict(
            decide_cycle(
                event_type="irrigation",
                is_manual=False,
                config=config,
                tank_readings=[],
                lights_dark=dark,
                cycles_today=cycles,
                volume_today=volume,
                cycle_volume_l=cycle_volume_liters(config, item["duration"]),
            )
        )
        for item in config.irrigation_times
        for dark in (False, True)
        for cycles in (0, 39, 40)
        for volume in (0.0, 17.5, 18.0)
    ]
    return {"steering": steering, "schedule": schedule, "contract": contract}


def wire(value):
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, date):
        return value.isoformat()
    raise TypeError(f"Unserializable verdict value: {type(value)}")


if __name__ == "__main__":
    print(json.dumps(tick_verdicts(json.load(sys.stdin)), default=wire))
