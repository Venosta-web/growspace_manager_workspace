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
    def test_current_eight_growspaces_and_entity_families_are_preserved(self) -> None:
        records = [
            record for record in expand_entities() if record.status is Status.COVERED
        ]
        counts: dict[str, int] = {}
        for record in records:
            counts[record.domain] = counts.get(record.domain, 0) + 1

        self.assertEqual(
            counts,
            {"sensor": 96, "input_number": 32, "switch": 16, "input_boolean": 16},
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
            },
        )

    def test_every_later_ticket_is_explicitly_reserved(self) -> None:
        planned_tickets = {
            assignment.delivery_ticket
            for role in ROLES
            for assignment in role.assignments
            if assignment.status is Status.PLANNED
        }
        self.assertEqual(planned_tickets, {17, 18, 19, 20, 21, 22, 23})
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
