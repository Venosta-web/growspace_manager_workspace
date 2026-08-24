"""Executable failure-mode tests for the E2E entity coverage contract."""

from __future__ import annotations

from dataclasses import replace
import json
import unittest

from e2e.entity_coverage import (
    EXACTLY_ONE,
    PROFILES,
    ROLES,
    CoverageRole,
    Status,
    build_card_manifest,
    expand_entities,
    extract_generated_entity_ids,
    render_ha_package,
    validate_contract,
    validate_generated_entities,
    validate_setup_manifest,
)


class EntityCoverageContractTest(unittest.TestCase):
    def test_delivered_growspaces_and_entity_families_are_complete(self) -> None:
        records = [
            record for record in expand_entities() if record.status is Status.COVERED
        ]
        counts: dict[str, int] = {}
        for record in records:
            counts[record.domain] = counts.get(record.domain, 0) + 1

        self.assertEqual(
            counts,
            {
                "sensor": 96,
                "input_number": 33,
                "switch": 20,
                "input_boolean": 21,
                "binary_sensor": 1,
                "light": 1,
            },
        )
        self.assertEqual(
            {profile["slug"] for profile in build_card_manifest()["profiles"]},
            {
                "veg",
                "clone",
                "mother",
                "flower",
                "dry",
                "cure",
                "vwc_veg",
                "vwc_flower",
                "irrigation_monitored",
                "irrigation_tanks",
                "lighting",
            },
        )

    def test_every_later_ticket_is_explicitly_reserved(self) -> None:
        planned_tickets = {
            assignment.delivery_ticket
            for role in ROLES
            for assignment in role.assignments
            if assignment.status is Status.PLANNED
        }
        self.assertEqual(planned_tickets, {18, 20, 21, 22, 23})
        self.assertTrue(
            {
                "environment",
                "irrigation",
                "lighting",
                "climate",
                "source_air",
                "ac_infinity",
                "vision",
            }
            <= {role.category for role in ROLES}
        )

    def test_irrigation_profiles_expose_distinct_truthful_hardware(self) -> None:
        profiles = {
            profile["profile"]: profile
            for profile in build_card_manifest()["profiles"]
            if profile["profile"].startswith("irrigation_")
        }

        monitored = profiles["irrigation_monitored"]["services"]
        self.assertEqual(
            set(monitored["configure_environment"]),
            {"drain_volume_sensors", "irrigation_flow_sensors"},
        )
        self.assertEqual(
            set(monitored["set_irrigation_settings"]),
            {"irrigation_pump_entity", "drain_pump_entity"},
        )

        tanks = profiles["irrigation_tanks"]["services"]
        tank_rows = tanks["configure_environment"]["irrigation_tanks"]
        self.assertEqual(len(tank_rows), 2)
        self.assertEqual([row["name"] for row in tank_rows], ["Tank 1", "Tank 2"])
        self.assertTrue(all(row["volume_liters"] == 50 for row in tank_rows))
        self.assertNotIn("irrigation_flow_sensors", tanks["configure_environment"])
        self.assertNotIn("drain_volume_sensors", tanks["configure_environment"])
        self.assertEqual(
            set(tanks["set_irrigation_settings"]), {"irrigation_pump_entity"}
        )

    def test_vwc_profiles_keep_tank_guard_without_direct_water_sensors(self) -> None:
        vwc_profiles = [
            profile
            for profile in build_card_manifest()["profiles"]
            if profile["profile"] == "vwc"
        ]

        self.assertEqual(len(vwc_profiles), 2)
        for profile in vwc_profiles:
            environment = profile["services"]["configure_environment"]
            self.assertEqual(len(environment["irrigation_tanks"]), 1)
            self.assertNotIn("irrigation_flow_sensors", environment)
            self.assertNotIn("drain_volume_sensors", environment)
            self.assertIn(
                "irrigation_pump_entity",
                profile["services"]["set_irrigation_settings"],
            )

    def test_controllable_tanks_use_safe_percentage_limits(self) -> None:
        package = render_ha_package()

        for object_id in (
            "e2e_vwc_veg_irrigation_tank",
            "e2e_vwc_flower_irrigation_tank",
            "e2e_irrigation_tanks_irrigation_tank_1",
            "e2e_irrigation_tanks_irrigation_tank_2",
        ):
            block = package.split(f"  {object_id}:\n", 1)[1].split("  e2e_", 1)[0]
            self.assertIn("    min: 0\n", block)
            self.assertIn("    max: 100\n", block)
            self.assertIn("    initial: 80\n", block)
            self.assertIn('    unit_of_measurement: "%"\n', block)

    def test_lighting_profile_wires_tracking_controller_and_plain_actuators(self) -> None:
        profile = next(
            profile
            for profile in build_card_manifest()["profiles"]
            if profile["profile"] == "lighting"
        )

        environment = profile["services"]["configure_environment"]
        self.assertEqual(
            environment["light_sensors"],
            ["binary_sensor.e2e_lighting_light_state"],
        )
        self.assertEqual(
            environment["growlight_entities"],
            [
                "switch.e2e_lighting_growlight_switch",
                "light.e2e_lighting_growlight_dimmable",
            ],
        )
        self.assertEqual(
            environment["growlight_config"],
            {
                "enabled": True,
                "power": 65,
                "sunrise_enabled": False,
                "sunrise_minutes": 0,
            },
        )
        self.assertEqual(
            profile["services"]["set_irrigation_strategy"],
            {
                "enabled": True,
                "auto_light_tracking": True,
                "lights_on_time": "06:00:00",
            },
        )

    def test_lighting_simulator_is_state_backed_and_restart_deterministic(self) -> None:
        package = render_ha_package()

        self.assertEqual(package, render_ha_package())
        self.assertIn(
            "state: \"{{ is_state('switch.e2e_lighting_growlight_switch', 'on') "
            "or is_state('light.e2e_lighting_growlight_dimmable', 'on') }}\"",
            package,
        )
        self.assertIn(
            "input_boolean.e2e_lighting_growlight_dimmable", package
        )
        self.assertIn(
            "input_number.e2e_lighting_growlight_dimmable_brightness", package
        )
        self.assertIn(
            "  e2e_lighting_growlight_switch:\n"
            "    name: e2e lighting growlight switch\n"
            "    initial: false\n",
            package,
        )
        self.assertIn(
            "  e2e_lighting_growlight_dimmable_brightness:\n"
            "    name: e2e lighting growlight dimmable brightness\n"
            "    min: 0\n"
            "    max: 255\n"
            "    step: 1\n"
            "    initial: 128\n",
            package,
        )

    def test_duplicate_entity_ids_fail_validation(self) -> None:
        original = ROLES[0]
        duplicate = CoverageRole(
            "test.duplicate",
            "test",
            "Deliberate duplicate",
            EXACTLY_ONE,
            (original.assignments[0],),
        )

        errors = validate_contract(PROFILES, (*ROLES, duplicate))

        self.assertTrue(
            any(
                "duplicate entity id sensor.e2e_veg_temperature" in error
                for error in errors
            )
        )

    def test_setup_reference_without_generated_entity_fails_validation(self) -> None:
        manifest = json.loads(json.dumps(build_card_manifest()))
        manifest["profiles"][0]["services"]["configure_environment"][
            "temperature_sensor"
        ] = "sensor.e2e_missing_temperature"
        generated = extract_generated_entity_ids(render_ha_package())

        errors = validate_setup_manifest(manifest, generated)

        self.assertEqual(len(errors), 1)
        self.assertIn("setup reference has no generated entity", errors[0])

    def test_generated_entity_without_declared_role_fails_validation(self) -> None:
        generated = extract_generated_entity_ids(render_ha_package())
        generated.append("sensor.e2e_undeclared")

        errors = validate_generated_entities(generated)

        self.assertIn(
            "generated entity has no declared covered role: sensor.e2e_undeclared",
            errors,
        )

    def test_domain_mismatch_fails_validation(self) -> None:
        original = ROLES[0]
        bad_assignment = replace(original.assignments[0], domain="input_number")
        bad_role = replace(
            original,
            id="test.domain_mismatch",
            assignments=(bad_assignment,),
        )
        roles = (bad_role, *ROLES[1:])

        errors = validate_contract(PROFILES, roles)

        self.assertTrue(
            any(
                "domain mismatch for sensor.e2e_veg_temperature" in error
                and "expects input_number" in error
                for error in errors
            )
        )


if __name__ == "__main__":
    unittest.main()
