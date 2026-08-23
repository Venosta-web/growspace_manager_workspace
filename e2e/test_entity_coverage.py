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
            {"sensor": 115, "input_number": 51, "switch": 19, "input_boolean": 20},
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
                "telemetry_multi",
            },
        )

    def test_every_later_ticket_is_explicitly_reserved(self) -> None:
        planned_tickets = {
            assignment.delivery_ticket
            for role in ROLES
            for assignment in role.assignments
            if assignment.status is Status.PLANNED
        }
        self.assertEqual(planned_tickets, {19, 20, 21, 22, 23})
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

    def test_multi_telemetry_covers_every_environmental_category(self) -> None:
        environment = {
            profile["profile"]: profile["services"]["configure_environment"]
            for profile in build_card_manifest()["profiles"]
        }["telemetry_multi"]

        # The four basic categories the backend accepts as lists get two
        # independently valued sensors each; the rest get the one the ticket
        # asks for, addressed through whichever spelling the backend supports.
        self.assertEqual(
            {
                field: len(value)
                for field, value in environment.items()
                if isinstance(value, list)
            },
            {
                "temperature_sensors": 2,
                "humidity_sensors": 2,
                "vpd_sensors": 2,
                "light_sensors": 2,
                "substrate_temperature_sensors": 2,
                "ph_sensors": 1,
                "feed_ec_sensors": 1,
                "bulk_ec_sensors": 1,
                "pore_ec_sensors": 1,
                "runoff_ec_sensors": 1,
                "power_sensors": 1,
                "energy_sensors": 1,
            },
        )
        # CO2 and soil moisture have no plural spelling in the backend schema,
        # so the canonical field for them is the scalar one.
        self.assertEqual(
            {
                field: value
                for field, value in environment.items()
                if not isinstance(value, list)
            },
            {
                "co2_sensor": "sensor.e2e_telemetry_multi_co2",
                "soil_moisture_sensor": (
                    "sensor.e2e_telemetry_multi_substrate_moisture"
                ),
            },
        )
        # Every plural field is set outright, so a rerun replaces the list
        # rather than growing it, and no singular shadow is sent that a later
        # rerun could resurrect over a deliberately changed list.
        for field, value in environment.items():
            if isinstance(value, list):
                self.assertEqual(len(set(value)), len(value), field)
        self.assertNotIn("temperature_sensor", environment)
        self.assertNotIn("humidity_sensor", environment)
        self.assertNotIn("vpd_sensor", environment)

        # Nothing from an exclusive irrigation-hardware profile leaks in.
        for field in ("irrigation_tanks", "irrigation_flow_sensors"):
            self.assertNotIn(field, environment)

    def test_multi_telemetry_entities_are_recordable_sensors(self) -> None:
        entities = {
            entity["entity_id"]: entity
            for entity in build_card_manifest()["entities"]
            if entity["profile"] == "telemetry_multi"
        }
        environment = {
            profile["profile"]: profile["services"]["configure_environment"]
            for profile in build_card_manifest()["profiles"]
        }["telemetry_multi"]

        configured = [
            entity_id
            for value in environment.values()
            for entity_id in (value if isinstance(value, list) else [value])
        ]
        self.assertTrue(configured)
        for entity_id in configured:
            entity = entities[entity_id]
            self.assertEqual(entity["domain"], "sensor", entity_id)
            self.assertTrue(entity["unit_of_measurement"], entity_id)
            self.assertIn(
                entity["state_class"], {"measurement", "total_increasing"}, entity_id
            )
            # Read-only, because the writable half is the backing input; a test
            # that wrote the sensor directly would be overwritten by the next
            # template render.
            self.assertEqual(entity["behavior"], "read-only", entity_id)
            self.assertIn(entity["backing_entity_id"], entities, entity_id)
            self.assertEqual(
                entities[entity["backing_entity_id"]]["behavior"], "controllable"
            )

        self.assertEqual(
            {
                entity["device_class"]
                for entity in entities.values()
                if entity.get("device_class")
            },
            {
                "temperature",
                "humidity",
                "carbon_dioxide",
                "moisture",
                "illuminance",
                "power",
                "energy",
            },
        )

    def test_mirrored_sensor_without_its_backing_input_fails_validation(self) -> None:
        temperature = next(
            role for role in ROLES if role.id == "environment.temperature"
        )
        mirror = next(
            assignment
            for assignment in temperature.assignments
            if assignment.profile == "telemetry_multi"
        )
        renamed = replace(
            temperature,
            assignments=(
                replace(mirror, entity_id_rule="sensor.e2e_{slug}_temp{ordinal_suffix}"),
            ),
        )

        errors = validate_contract(
            PROFILES,
            tuple(renamed if role is temperature else role for role in ROLES),
        )

        self.assertTrue(
            any(
                "reads input_number.sim_e2e_telemetry_multi_temp_1" in error
                and "which no role generates" in error
                for error in errors
            ),
            errors,
        )

    def test_pinned_and_free_running_values_share_one_gate(self) -> None:
        package = render_ha_package()
        gate = "input_boolean.sim_e2e_telemetry_multi_manual_telemetry"
        block = package.split("# e2e_telemetry_multi — ", 1)[1].split("# pumps", 1)[0]

        # Every mirrored sensor re-renders when the gate or any backing input is
        # written, so a pinned value is visible immediately rather than at the
        # next half-minute tick.
        self.assertIn("      - platform: state\n", block)
        self.assertIn(f"          - {gate}\n", block)

        for line in block.splitlines():
            if not line.strip().startswith("{{"):
                continue
            self.assertIn(f"is_state('{gate}', 'on')", line)
            self.assertIn("else", line)

        self.assertIn(
            "{{ states('input_number.sim_e2e_telemetry_multi_temperature_1') "
            "| float(0) | round(2) if",
            block,
        )

    def test_paired_sensors_start_apart_and_never_share_a_waveform(self) -> None:
        package = render_ha_package()
        first = package.split("  sim_e2e_telemetry_multi_temperature_1:\n", 1)[1]
        second = package.split("  sim_e2e_telemetry_multi_temperature_2:\n", 1)[1]

        self.assertIn("    initial: 22.67\n", first)
        self.assertIn("    initial: 25.33\n", second)

        waveforms = [
            line
            for line in package.splitlines()
            if "e2e_telemetry_multi_temperature_" in line and "sin(" in line
        ]
        self.assertEqual(len(waveforms), 2)
        self.assertNotEqual(waveforms[0], waveforms[1])

    def test_growspace_name_that_slugs_elsewhere_fails_validation(self) -> None:
        telemetry = next(
            profile for profile in PROFILES if profile.id == "telemetry_multi"
        )
        renamed = replace(
            telemetry,
            instances=(replace(telemetry.instances[0], name="E2E Multi Telemetry"),),
        )

        errors = validate_contract(
            tuple(renamed if p is telemetry else p for p in PROFILES), ROLES
        )

        self.assertEqual(
            errors,
            [
                "profile telemetry_multi instance telemetry_multi is named "
                "'E2E Multi Telemetry'; Home Assistant would name its overview "
                "sensor sensor.e2e_multi_telemetry_overview, not "
                "sensor.e2e_telemetry_multi_overview"
            ],
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
