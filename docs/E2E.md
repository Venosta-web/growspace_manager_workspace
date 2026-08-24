# End-to-end test environment

The Playwright suite in `lovelace-growspace-manager-card/tests/e2e` runs against
a **real Home Assistant instance** — the dev runtime on :8123. Three things have
to exist before it can run, and all three are reproducible from scripts.

## 1. Simulated sensors

`./scripts/gen-e2e-sensors` writes `ha-dev/packages/e2e_simulated_sensors.yaml`,
loaded via `homeassistant.packages` in `ha-dev/configuration.yaml`.

The executable contract in `e2e/entity_coverage.py` owns the entity inventory,
the thirteen current capability-profile instances, their setup payloads, and the
roles reserved for the later simulator tickets. The generated package, the card
setup manifest, and this coverage table are checked against it by
`./scripts/check-e2e-coverage`.

<!-- BEGIN GENERATED E2E ENTITY COVERAGE -->
<!-- Regenerate with ./scripts/gen-e2e-sensors; do not edit this table. -->

| Role | Category | Capability profile | Entity naming rule | Domain | Cardinality | Behavior | Delivery |
|---|---|---|---|---|---|---|---|
| `environment.temperature` | environment | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_temperature` | `sensor` | one or more (1) | read-only | covered |
| `environment.temperature` | environment | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_temperature` | `input_number` | one or more (1) | controllable | covered |
| `environment.temperature` | environment | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_temperature{ordinal_suffix}` | `sensor` | one or more (2) | read-only | covered |
| `environment.temperature` | environment | `climate_plain` (climate_plain) | `input_number.e2e_{slug}_temperature` | `input_number` | one or more (1) | controllable | covered |
| `environment.humidity` | environment | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_humidity` | `sensor` | one or more (1) | read-only | covered |
| `environment.humidity` | environment | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_humidity` | `input_number` | one or more (1) | controllable | covered |
| `environment.humidity` | environment | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_humidity{ordinal_suffix}` | `sensor` | one or more (2) | read-only | covered |
| `environment.humidity` | environment | `climate_plain` (climate_plain) | `input_number.e2e_{slug}_humidity` | `input_number` | one or more (1) | controllable | covered |
| `environment.vpd` | environment | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_vpd` | `sensor` | one or more (1) | read-only | covered |
| `environment.vpd` | environment | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_vpd` | `input_number` | one or more (1) | controllable | covered |
| `environment.vpd` | environment | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_vpd{ordinal_suffix}` | `sensor` | one or more (2) | read-only | covered |
| `environment.vpd` | environment | `climate_plain` (climate_plain) | `input_number.e2e_{slug}_vpd` | `input_number` | one or more (1) | controllable | covered |
| `environment.co2` | environment | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_co2` | `sensor` | exactly one (1) | read-only | covered |
| `environment.co2` | environment | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_co2` | `input_number` | exactly one (1) | controllable | covered |
| `environment.co2` | environment | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_co2{ordinal_suffix}` | `sensor` | exactly one (1) | read-only | covered |
| `irrigation.feed_ec` | irrigation | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_feed_ec` | `sensor` | one or more (1) | read-only | covered |
| `irrigation.feed_ec` | irrigation | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_feed_ec` | `input_number` | one or more (1) | controllable | covered |
| `irrigation.feed_ec` | irrigation | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_feed_ec{ordinal_suffix}` | `sensor` | one or more (1) | read-only | covered |
| `irrigation.bulk_ec` | irrigation | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_bulk_ec` | `sensor` | one or more (1) | read-only | covered |
| `irrigation.bulk_ec` | irrigation | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_bulk_ec` | `input_number` | one or more (1) | controllable | covered |
| `irrigation.bulk_ec` | irrigation | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_bulk_ec{ordinal_suffix}` | `sensor` | one or more (1) | read-only | covered |
| `irrigation.pore_ec` | irrigation | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_pore_ec` | `sensor` | one or more (1) | read-only | covered |
| `irrigation.pore_ec` | irrigation | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_pore_ec` | `input_number` | one or more (1) | controllable | covered |
| `irrigation.pore_ec` | irrigation | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_pore_ec{ordinal_suffix}` | `sensor` | one or more (1) | read-only | covered |
| `irrigation.runoff_ec` | irrigation | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_runoff_ec` | `sensor` | one or more (1) | read-only | covered |
| `irrigation.runoff_ec` | irrigation | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_runoff_ec` | `input_number` | one or more (1) | controllable | covered |
| `irrigation.runoff_ec` | irrigation | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_runoff_ec{ordinal_suffix}` | `sensor` | one or more (1) | read-only | covered |
| `irrigation.ph` | irrigation | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_ph` | `sensor` | one or more (1) | read-only | covered |
| `irrigation.ph` | irrigation | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_ph` | `input_number` | one or more (1) | controllable | covered |
| `irrigation.ph` | irrigation | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_ph{ordinal_suffix}` | `sensor` | one or more (1) | read-only | covered |
| `environment.substrate_temperature` | environment | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_substrate_temperature` | `sensor` | one or more (1) | read-only | covered |
| `environment.substrate_temperature` | environment | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_substrate_temperature` | `input_number` | one or more (1) | controllable | covered |
| `environment.substrate_temperature` | environment | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_substrate_temperature{ordinal_suffix}` | `sensor` | one or more (2) | read-only | covered |
| `environment.substrate_moisture` | environment | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_substrate_moisture` | `sensor` | exactly one (1) | read-only | covered |
| `environment.substrate_moisture` | environment | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_substrate_moisture` | `input_number` | exactly one (1) | controllable | covered |
| `environment.substrate_moisture` | environment | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_substrate_moisture{ordinal_suffix}` | `sensor` | exactly one (1) | read-only | covered |
| `environment.power` | environment | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_power` | `sensor` | one or more (1) | read-only | covered |
| `environment.power` | environment | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_power` | `input_number` | one or more (1) | controllable | covered |
| `environment.power` | environment | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_power{ordinal_suffix}` | `sensor` | one or more (1) | read-only | covered |
| `environment.energy` | environment | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_energy` | `sensor` | one or more (1) | read-only | covered |
| `environment.energy` | environment | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_energy` | `input_number` | one or more (1) | controllable | covered |
| `environment.energy` | environment | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_energy{ordinal_suffix}` | `sensor` | one or more (1) | read-only | covered |
| `irrigation.drain_volume` | irrigation | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_drain_volume` | `sensor` | one or more (1) | read-only | covered |
| `irrigation.drain_volume` | irrigation | `irrigation_monitored` (irrigation_monitored) | `input_number.e2e_{slug}_drain_volume` | `input_number` | one or more (1) | controllable | covered |
| `irrigation.flow` | irrigation | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_irrigation_flow` | `sensor` | one or more (1) | read-only | covered |
| `irrigation.flow` | irrigation | `irrigation_monitored` (irrigation_monitored) | `input_number.e2e_{slug}_irrigation_flow` | `input_number` | one or more (1) | controllable | covered |
| `irrigation.tank_level` | irrigation | `stage` (veg, clone, mother, flower, dry, cure) | `sensor.e2e_{slug}_irrigation_tank` | `sensor` | one or more (1) | read-only | covered |
| `irrigation.tank_level` | irrigation | `vwc` (vwc_veg, vwc_flower) | `input_number.e2e_{slug}_irrigation_tank` | `input_number` | one or more (1) | controllable | covered |
| `irrigation.tank_level` | irrigation | `irrigation_tanks` (irrigation_tanks) | `input_number.e2e_{slug}_irrigation_tank{ordinal_suffix}` | `input_number` | one or more (2) | controllable | covered |
| `environment.light` | lighting | `telemetry_multi` (telemetry_multi) | `sensor.e2e_{slug}_light{ordinal_suffix}` | `sensor` | one or more (2) | read-only | covered |
| `irrigation.irrigation_pump` | irrigation | `stage` (veg, clone, mother, flower, dry, cure) | `switch.sim_e2e_{slug}_irrigation_pump` | `switch` | exactly one (1) | controllable | covered |
| `irrigation.irrigation_pump` | irrigation | `vwc` (vwc_veg, vwc_flower) | `switch.sim_e2e_{slug}_irrigation_pump` | `switch` | exactly one (1) | controllable | covered |
| `irrigation.irrigation_pump` | irrigation | `irrigation_monitored` (irrigation_monitored) | `switch.sim_e2e_{slug}_irrigation_pump` | `switch` | exactly one (1) | controllable | covered |
| `irrigation.irrigation_pump` | irrigation | `irrigation_tanks` (irrigation_tanks) | `switch.sim_e2e_{slug}_irrigation_pump` | `switch` | exactly one (1) | controllable | covered |
| `irrigation.drain_pump` | irrigation | `stage` (veg, clone, mother, flower, dry, cure) | `switch.sim_e2e_{slug}_drain_pump` | `switch` | exactly one (1) | controllable | covered |
| `irrigation.drain_pump` | irrigation | `vwc` (vwc_veg, vwc_flower) | `switch.sim_e2e_{slug}_drain_pump` | `switch` | exactly one (1) | controllable | covered |
| `irrigation.drain_pump` | irrigation | `irrigation_monitored` (irrigation_monitored) | `switch.sim_e2e_{slug}_drain_pump` | `switch` | exactly one (1) | controllable | covered |
| `simulation.irrigation_pump_state` | internal | `stage` (veg, clone, mother, flower, dry, cure) | `input_boolean.sim_e2e_{slug}_irrigation_pump` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.irrigation_pump_state` | internal | `vwc` (vwc_veg, vwc_flower) | `input_boolean.sim_e2e_{slug}_irrigation_pump` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.irrigation_pump_state` | internal | `irrigation_monitored` (irrigation_monitored) | `input_boolean.sim_e2e_{slug}_irrigation_pump` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.irrigation_pump_state` | internal | `irrigation_tanks` (irrigation_tanks) | `input_boolean.sim_e2e_{slug}_irrigation_pump` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.drain_pump_state` | internal | `stage` (veg, clone, mother, flower, dry, cure) | `input_boolean.sim_e2e_{slug}_drain_pump` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.drain_pump_state` | internal | `vwc` (vwc_veg, vwc_flower) | `input_boolean.sim_e2e_{slug}_drain_pump` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.drain_pump_state` | internal | `irrigation_monitored` (irrigation_monitored) | `input_boolean.sim_e2e_{slug}_drain_pump` | `input_boolean` | exactly one (1) | controllable | covered |
| `lighting.state` | lighting | `lighting` (lighting) | `binary_sensor.e2e_{slug}_light_state` | `binary_sensor` | one or more (1) | read-only | covered |
| `lighting.growlight_switch` | lighting | `lighting` (lighting) | `switch.e2e_{slug}_growlight_switch` | `switch` | one or more (1) | controllable | covered |
| `lighting.growlight_dimmable` | lighting | `lighting` (lighting) | `light.e2e_{slug}_growlight_dimmable` | `light` | one or more (1) | controllable | covered |
| `simulation.growlight_switch_state` | internal | `lighting` (lighting) | `input_boolean.e2e_{slug}_growlight_switch` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.growlight_dimmable_state` | internal | `lighting` (lighting) | `input_boolean.e2e_{slug}_growlight_dimmable` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.growlight_dimmable_brightness` | internal | `lighting` (lighting) | `input_number.e2e_{slug}_growlight_dimmable_brightness` | `input_number` | exactly one (1) | controllable | covered |
| `simulation.temperature_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_temperature{ordinal_suffix}` | `input_number` | one or more (2) | controllable | covered |
| `simulation.humidity_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_humidity{ordinal_suffix}` | `input_number` | one or more (2) | controllable | covered |
| `simulation.vpd_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_vpd{ordinal_suffix}` | `input_number` | one or more (2) | controllable | covered |
| `simulation.co2_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_co2{ordinal_suffix}` | `input_number` | exactly one (1) | controllable | covered |
| `simulation.feed_ec_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_feed_ec{ordinal_suffix}` | `input_number` | one or more (1) | controllable | covered |
| `simulation.bulk_ec_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_bulk_ec{ordinal_suffix}` | `input_number` | one or more (1) | controllable | covered |
| `simulation.pore_ec_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_pore_ec{ordinal_suffix}` | `input_number` | one or more (1) | controllable | covered |
| `simulation.runoff_ec_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_runoff_ec{ordinal_suffix}` | `input_number` | one or more (1) | controllable | covered |
| `simulation.ph_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_ph{ordinal_suffix}` | `input_number` | one or more (1) | controllable | covered |
| `simulation.substrate_temperature_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_substrate_temperature{ordinal_suffix}` | `input_number` | one or more (2) | controllable | covered |
| `simulation.substrate_moisture_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_substrate_moisture{ordinal_suffix}` | `input_number` | exactly one (1) | controllable | covered |
| `simulation.power_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_power{ordinal_suffix}` | `input_number` | one or more (1) | controllable | covered |
| `simulation.energy_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_energy{ordinal_suffix}` | `input_number` | one or more (1) | controllable | covered |
| `simulation.light_input` | internal | `telemetry_multi` (telemetry_multi) | `input_number.sim_e2e_{slug}_light{ordinal_suffix}` | `input_number` | one or more (2) | controllable | covered |
| `simulation.manual_telemetry` | internal | `telemetry_multi` (telemetry_multi) | `input_boolean.sim_e2e_{slug}_manual_telemetry` | `input_boolean` | exactly one (1) | controllable | covered |
| `climate.circulation_percentage` | climate | `climate_plain` (climate_plain) | `fan.e2e_{slug}_circulation_fan_percentage` | `fan` | one or more (1) | controllable | covered |
| `climate.circulation_numeric` | climate | `climate_plain` (climate_plain) | `input_number.e2e_{slug}_circulation_fan_speed` | `input_number` | one or more (1) | controllable | covered |
| `climate.circulation_binary` | climate | `climate_plain` (climate_plain) | `switch.e2e_{slug}_circulation_fan_switch` | `switch` | one or more (1) | controllable | covered |
| `climate.exhaust_percentage` | climate | `climate_plain` (climate_plain) | `fan.e2e_{slug}_exhaust_fan_percentage` | `fan` | one or more (1) | controllable | covered |
| `climate.exhaust_numeric` | climate | `climate_plain` (climate_plain) | `input_number.e2e_{slug}_exhaust_fan_speed` | `input_number` | one or more (1) | controllable | covered |
| `climate.exhaust_binary` | climate | `climate_plain` (climate_plain) | `switch.e2e_{slug}_exhaust_fan_switch` | `switch` | one or more (1) | controllable | covered |
| `climate.humidifier_native` | climate | `climate_plain` (climate_plain) | `humidifier.e2e_{slug}_humidifier_native` | `humidifier` | one or more (1) | controllable | covered |
| `climate.humidifier_switch` | climate | `climate_plain` (climate_plain) | `switch.e2e_{slug}_humidifier_switch` | `switch` | one or more (1) | controllable | covered |
| `climate.dehumidifier_native` | climate | `climate_plain` (climate_plain) | `humidifier.e2e_{slug}_dehumidifier_native` | `humidifier` | one or more (1) | controllable | covered |
| `climate.dehumidifier_switch` | climate | `climate_plain` (climate_plain) | `switch.e2e_{slug}_dehumidifier_switch` | `switch` | one or more (1) | controllable | covered |
| `simulation.circulation_percentage_state` | internal | `climate_plain` (climate_plain) | `input_boolean.e2e_{slug}_circulation_fan_percentage` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.circulation_binary_state` | internal | `climate_plain` (climate_plain) | `input_boolean.e2e_{slug}_circulation_fan_switch` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.exhaust_percentage_state` | internal | `climate_plain` (climate_plain) | `input_boolean.e2e_{slug}_exhaust_fan_percentage` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.exhaust_binary_state` | internal | `climate_plain` (climate_plain) | `input_boolean.e2e_{slug}_exhaust_fan_switch` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.humidifier_native_state` | internal | `climate_plain` (climate_plain) | `input_boolean.e2e_{slug}_humidifier_native` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.humidifier_switch_state` | internal | `climate_plain` (climate_plain) | `input_boolean.e2e_{slug}_humidifier_switch` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.dehumidifier_native_state` | internal | `climate_plain` (climate_plain) | `input_boolean.e2e_{slug}_dehumidifier_native` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.dehumidifier_switch_state` | internal | `climate_plain` (climate_plain) | `input_boolean.e2e_{slug}_dehumidifier_switch` | `input_boolean` | exactly one (1) | controllable | covered |
| `simulation.circulation_percentage_value` | internal | `climate_plain` (climate_plain) | `input_number.e2e_{slug}_circulation_fan_percentage_value` | `input_number` | exactly one (1) | controllable | covered |
| `simulation.exhaust_percentage_value` | internal | `climate_plain` (climate_plain) | `input_number.e2e_{slug}_exhaust_fan_percentage_value` | `input_number` | exactly one (1) | controllable | covered |
| `ac_infinity.circulation.mode_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `select.e2e_{slug}_circulation_active_mode` | `select` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `ac_infinity.circulation.speed_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `number.e2e_{slug}_circulation_speed` | `number` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `ac_infinity.exhaust.mode_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `select.e2e_{slug}_exhaust_active_mode` | `select` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `ac_infinity.exhaust.speed_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `number.e2e_{slug}_exhaust_speed` | `number` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `ac_infinity.humidifier.mode_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `select.e2e_{slug}_humidifier_active_mode` | `select` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `ac_infinity.humidifier.speed_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `number.e2e_{slug}_humidifier_speed` | `number` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `ac_infinity.dehumidifier.mode_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `select.e2e_{slug}_dehumidifier_active_mode` | `select` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `ac_infinity.dehumidifier.speed_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `number.e2e_{slug}_dehumidifier_speed` | `number` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `ac_infinity.growlight.mode_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `select.e2e_{slug}_growlight_active_mode` | `select` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `ac_infinity.growlight.on_time_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `time.e2e_{slug}_growlight_on_time` | `time` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `ac_infinity.growlight.off_time_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `time.e2e_{slug}_growlight_off_time` | `time` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `ac_infinity.growlight.power_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `number.e2e_{slug}_growlight_on_power` | `number` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `ac_infinity.growlight.sunrise_switch_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `switch.e2e_{slug}_growlight_sunrise_enabled` | `switch` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `ac_infinity.growlight.sunrise_duration_entity` | ac_infinity | `ac_infinity` (ac_infinity) | `number.e2e_{slug}_growlight_sunrise_duration` | `number` | exactly one (1) | controllable | planned in [#20](https://github.com/Venosta-web/growspace_manager_workspace/issues/20) |
| `source_air.temperature` | source_air | `source_air` (source_air) | `input_number.e2e_{slug}_temperature` | `input_number` | exactly one (1) | controllable | planned in [#23](https://github.com/Venosta-web/growspace_manager_workspace/issues/23) |
| `source_air.humidity` | source_air | `source_air` (source_air) | `input_number.e2e_{slug}_humidity` | `input_number` | exactly one (1) | controllable | planned in [#23](https://github.com/Venosta-web/growspace_manager_workspace/issues/23) |
| `source_air.weather` | source_air | `source_air` (source_air) | `weather.e2e_outdoor_conditions` | `weather` | exactly one (1) | read-only | planned in [#23](https://github.com/Venosta-web/growspace_manager_workspace/issues/23) |
| `vision.camera` | vision | `vision` (vision) | `camera.e2e_{slug}_{ordinal}` | `camera` | one or more (2) | read-only | covered |

<!-- END GENERATED E2E ENTITY COVERAGE -->

Waveforms are a pure function of `now()` — a sine between a per-signal low/high
over a per-signal period, with a 10-minute phase offset per growspace so the
spaces do not move in lockstep. Being time-derived, they are reproducible: the
same clock gives the same reading.

`energy` is the exception — it is `total_increasing` and must never decrease, so
it is a daily ramp rather than a sine.

Signals: temperature, humidity, vpd, co2, light, feed_ec, bulk_ec, pore_ec,
runoff_ec, ph, substrate_temperature, substrate_moisture, power, energy,
drain_volume, irrigation_flow, irrigation_tank.

```bash
./scripts/gen-e2e-sensors && ./scripts/ha dev restart
```

### Mirrored sensors: driveable and still alive

A waveform cannot be driven and a writable helper does not move on its own, and
the `telemetry_multi` profile needs both — a test must be able to set a
representative reading, while the dashboard must keep showing plausible,
continuously changing data. It also needs real `sensor.*` entities: only those
carry a device class and a state class, so only those are selectable in Home
Assistant's entity pickers, recorded as long-term statistics, and formatted by
the card the way production hardware is.

So every reading in that profile is a **mirrored sensor**: a template
`sensor.e2e_telemetry_multi_<signal>[_n]` whose state is

```
the writable input, if the gate is on — otherwise this signal's waveform
```

with `input_number.sim_e2e_telemetry_multi_<signal>[_n]` as the writable half
and `input_boolean.sim_e2e_telemetry_multi_manual_telemetry` as the gate. The
gate is **off** by default, so an untouched instance free-runs. Its template
block re-renders every 30 s *and* on any write to the gate or to a backing
input, so a pinned value lands at once instead of up to a tick later.

Paired sensors are offset by a quarter of their period and start at different
points in their range, so a category configured with two sensors never reads the
same value twice — an aggregate of two identical readings would prove nothing.

`e2e/entity_coverage.py` derives each backing input and each gate from the
mirror assignment that declares the sensor, and refuses to generate a mirror
whose backing input or gate does not exist. Adding a signal to the profile is one
`_telemetry_role(...)` call.

> Pumps must be declared under the `template:` key. The legacy
> `switch: - platform: template` form is rejected by current HA:
> *"Configuring the template integration under the switch platform key is not
> supported."*

### Plain climate actuators

The `climate_plain` profile owns one writable example of every fan mode the
card classifies: a percentage `fan`, a 0–10 `input_number`, and a binary
`switch`, independently for circulation and exhaust. Template fans and
switches use profile-local helpers, while native humidifier and dehumidifier
entities use Generic Hygrostat over their own profile-local backing inputs.
No actuator ID is shared with another growspace or controller.

Setup sends only the contract-derived plural entity arrays and the controller
fields this profile owns. Circulation and exhaust receive deterministic
targets and hysteresis; humidification and dehumidification receive explicit
flower-stage day/night thresholds. The three writable environmental inputs let
the E2E spec drive controller demand without physical sensors.

### Deterministic cameras

The vision profile uses two Local File config entries,
`camera.e2e_vision_1` and `camera.e2e_vision_2`. Their distinct JPEG sources
live under `ha-dev/www/e2e-camera-assets/`, so both the sources and snapshots
under `ha-dev/www/growspace_manager/snapshots/` are host-visible through the
`/config` bind mount.

`e2e-setup` creates the camera entries through Home Assistant's config flow and
reuses them on subsequent runs. It also repairs their source paths through the
Local File update action, assigns both cameras to the vision growspace, sets a
six-hour snapshot interval, and configures a representative Vision Checkup
schedule. Manual snapshots need no AI agent; the no-AI checkup case stops at
the integration's availability gate before any external request.

## 2. Growspaces

`tests/e2e/fixtures/e2e-setup.ts` creates the 14 growspaces, places an anchor
plant in each, links the sensors above, and writes the resulting IDs back into
`tests/e2e/.env.test`. It is idempotent — every profile-owned sensor list is set
outright, so a rerun replaces it rather than growing it, while fields outside
that profile's generated service payload remain untouched.

A growspace's own entities are named after the growspace, its simulated sensors
after the profile slug, and setup waits for `sensor.e2e_<slug>_overview` to
appear. The two must therefore agree: an instance named "E2E Multi Telemetry"
would get `sensor.e2e_multi_telemetry_overview` and setup would hang forever
waiting for `sensor.e2e_telemetry_multi_overview`. `validate_contract` checks
the name against the slug so this fails at generation time instead.

The script mixes ESM `import` with CommonJS `__dirname`, so it only runs under a
CJS transpiler. Neither `ts-node` nor `tsx` is installed; compile it instead:

```bash
cd ~/dev/lovelace-growspace-manager-card
npx --no-install tsc tests/e2e/fixtures/e2e-setup.ts --ignoreConfig \
  --module commonjs --target es2022 --esModuleInterop --skipLibCheck \
  --types node --outDir /tmp/e2e-build
cp /tmp/e2e-build/e2e-setup.js tests/e2e/fixtures/.e2e-setup.run.cjs
node tests/e2e/fixtures/.e2e-setup.run.cjs
rm tests/e2e/fixtures/.e2e-setup.run.cjs
cd ~/dev/growspace_manager_workspace
./scripts/ha dev restart
```

It must be copied back beside the original because it resolves `.env.test`
relative to `__dirname`. The restart is required after adding or changing tank
profiles: Home Assistant creates the tank-derived accounting sensors and their
state-change subscriptions when the integration's sensor platform starts.

## 3. Dashboards

Most specs are pure-API, but the ones that assert on what a grower actually
sees navigate to a dashboard and wait for `growspace-manager-card` to become
visible. `TEST_*_DASHBOARD_PATH` in `.env.test` points at these:

```bash
node scripts/gen-e2e-dashboards.cjs
```

Creates one dashboard per growspace (`/e2e-veg/0`, `/e2e-vwc-flower/0`, …).
Each dashboard uses a Sections view capped at four columns for a representative
desktop layout, with a single card bound to that growspace and sized to four
grid rows. The command is idempotent: rerunning it updates every existing stage
dashboard to the same layout and creates only the missing dashboards. It uses
the WebSocket API because HA has no REST endpoint for
`lovelace/dashboards/create`.

## Full rebuild from scratch

```bash
cd ~/dev/growspace_manager_workspace
./scripts/ha dev up
./scripts/ha dev token                       # once
./scripts/gen-e2e-sensors && ./scripts/ha dev restart
# then the e2e-setup compile-and-run above
# restart HA once more so profile-dependent sensor entities are registered
node scripts/gen-e2e-dashboards.cjs
cd ../lovelace-growspace-manager-card && npm run test:e2e
```

`.env.test` holds a long-lived token — it is gitignored and chmod 600. Never
commit it.

## Status

Verified 2026-08-22 against the generated environment:

| Spec | Result |
|---|---|
| `vwc-day-cycle` (pure-API, 12 tests) | **12 passed** in ~19 min, `--retries=0` (2026-08-23, twice) |
| `vwc-strategy` (dashboard, 3 tests) | card renders correctly; 3 fail on dialog interaction |

Before the generators existed, all of these failed at setup — the sensors,
pumps, input_numbers and dashboards simply were not there.

Full-suite run, 2026-08-22 (37 tests, 41.3 min): **17 passed, 18 failed,
2 flaky.** The dialog cause below is fixed; the remaining failures are the
three unrelated groups in "Full-suite breakdown".

### Two setup traps worth remembering

**The Lovelace resource must be registered over websocket.** A `resources:`
block under `lovelace:` is only honoured in YAML mode. This instance runs
`mode: storage`, where the block is silently ignored — the card JS never loads
and every navigating spec times out against an empty page with no error to
explain it. `gen-e2e-dashboards.cjs` handles this.

**The card config key is `default_growspace`, not `growspace_id`.** An
unrecognised key is ignored and the card auto-selects an arbitrary growspace, so
the dashboard renders fine while showing the *wrong* space — the "E2E VWC Veg"
dashboard displayed the Dry growspace. Silent and easy to miss.

With both fixed, the card renders the right growspace and displays the simulated
readings (temperature 24 °C, humidity 57.5 %, VPD 1.1 kPa, CO2 800 ppm — the
generated midpoints).

### Solved: no dialog could open — HA's service worker reloaded the page

Every dialog spec failed the same way:

```
expect(locator('config-dialog ha-dialog')).toHaveAttribute('open', '')
  element(s) not found, timeout 5000ms
```

That reads like the dialog never opened. It did. Polling the card's store every
200 ms after the click shows it open and then destroyed:

```
[poll  400ms] {"type":"CONFIG","portal":true,  "hostDefined":true}
[poll 2600ms] {"type":"CONFIG","portal":true,  "hostDefined":true}
[poll 2800ms] {"n":0}                       ← document gone
[poll 3000ms] {"type":"NONE", "portal":false, "hostDefined":false}
```

The HA frontend registers a **service worker** and calls `location.reload()` the
moment it takes control (`controllerchange`). Every Playwright context starts
with an empty SW registry, so the reload fires ~2 s into each test. Because
`growspace-manager-card` portals dialogs into `document.body`, the reload
destroys the portal *and* resets the global `activeDialog$` atom to `NONE`.

Fix: `serviceWorkers: 'block'` in `tests/e2e/playwright.config.ts`. Nothing under
test depends on the SW. `vwc-strategy` went 3 failed → **3 passed in 22 s, no
retries**.

Two earlier hypotheses were both wrong and worth not re-running: it is not a
lazy-load 404 (all 17 chunks serve 200), and it is not the 5 s expect timeout
being too short for the 351 KB code-split chunk (the dialog mounts in ~400 ms).

> **A stale `dist/` will masquerade as this.** The bundle being served was
> v1.0.31-alpha.1 while `package.json` said 1.1.6, and it shipped an unbundled
> bare specifier — `Failed to resolve module specifier "qrcode-generator"` —
> which broke the dialog-host chunk outright. Rollup emitted **no warning**. A
> fresh `rollup -c` bundles it correctly. Since `clean-dist` does
> `rmSync('dist')`, rebuilding also recreates the directory, so it needs
> `./scripts/ha dev restart` or Docker keeps serving the deleted inode.

All root-level e2e commands now run a bundle preflight before Playwright. The build
contains a hash of runtime source/build inputs plus a unique build ID; the preflight
compares both with the bundle served by HA. `npm run test:e2e` rebuilds, recreates HA
with the calling checkout's `dist/` mounted, waits for the exact build to be served,
then starts the suite. Direct `test:ha`, headed, and debug runs fail fast with the
required build/restart action when either side is stale.

### Full-suite breakdown

The 18 remaining failures are three groups, none of them the dialog layer:

**14 — the legacy dashboard path does not exist.** `TEST_DASHBOARD_PATH` is
`/dashboard-tesat/0`, but `gen-e2e-dashboards.cjs` only creates the eight
`e2e-*` dashboards. Every spec still on `testContext.dashboardPath` navigates to
a 404 and times out waiting for the card: `smoke` (4), `setup-dialogs` (4),
`plant-actions` (3), `insights-dialogs` (3). Either point that variable at
`e2e-veg`, or migrate those specs to a stage-specific path.

**2 — the tank sits under the irrigation cutoff.** `vwc-day-cycle` veg P1/P2
waited 90 s for a pump that never fired, because the coordinator was refusing to
run it:

```
Irrigation skipped — tank 'Tank' is low (29.0% < 30.0%)
```

A VWC growspace's tank is an `input_number`, not one of the generated sine
waves, so it holds whatever was last written to it. The regression had two
causes:

- The generated helpers used to start at 29 %, one point below the default
  30 % warning threshold. They now use realistic 0–100 % limits and start at
  80 %, so a clean HA restart is immediately safe for Crop Steering.
- The suite's own tank guard test drains it to 15 % and nothing ever put it
  back, so every pump test that ran after it was skipped too.

The generated default and the spec now reinforce each other: `beforeEach` fills
the tank and asserts the fill landed, and the pump waits re-check the level on
every poll, so a low tank fails immediately naming the cause instead of after
90 s of nothing.

**2 — genuine test timeouts.** `add-plant-dialog` (30 s) and
`plant-watering-round-trip` (45 s) both get *past* dialog-open and die while
filling a field or clicking a button, so they are slow rather than blocked.

`vwc-day-cycle` is pure-API — it never navigates a browser — so none of its
results are affected by the service-worker change.

### The two "flaky" tests

`P2 — maintenance shot fires after target reached` (veg and flower) failed on
the first attempt and passed on retry:

```
Entity switch.sim_e2e_vwc_flower_irrigation_pump expected "on" but got "off" after 90000ms
```

This was first written up as a marginal timeout — the 90 s window being tight
against the coordinator's polling interval — with "raise the timeout" as the
fix. That diagnosis was wrong. The pump is not late; the coordinator is
declining to run it, for the low-tank reason above. No timeout is long enough
for a shot that is being skipped. It is not the simulation either: VWC
growspaces read `input_number` helpers the spec sets directly, so none of their
values come from the generated sine waves.

A test that depends on tank state it never establishes passes or fails on
whatever the instance happens to be holding, which is what made these read as
flaky rather than broken. `vwc-day-cycle` now sets the tank in `beforeEach` and
fails fast with the cause when it is low — see the group above.

**The second cause: the shot window was too short.** With the tank fix alone,
veg `P2 — maintenance shot` still failed in a full run and still passed on its
own. Not the tank — the failure said `tank at 80%, cutoff 30%`. A P2 maintenance
shot is **three ticks** away from "VWC is at target", and 90 s covers two:

```
10:20:42  reached target VWC 65.0%. Switching to P2      no shot — by design
10:21:42  VWC (61.0%) dropped below maintenance trigger  shot withheld
          transitioned from P1 to P2
10:22:42  same decision                                  shot fires
```

The middle tick is withheld by the [[Infiltration Gate]] —
`sensor.e2e_<slug>_crop_steering_score` reports `suppressed_by: "infiltrating"`.
The spec manufactures that signal itself: it raises VWC ~20 points within
seconds of the preceding P1 test's shot, which is indistinguishable from the
substrate still absorbing it. The gate is behaving correctly. It also explains
the isolation pass — the coordinator skips both the cooldown and the gate when
there is no previous shot to measure against.

Fixed in Venosta-web/lovelace-growspace-manager-card#714: the window is now four
ticks (the ceiling implied by `INFILTRATION_BACKSTOP_INTERVALS = 3`) and pump
failures carry the coordinator's own account of itself — phase, `suppressed_by`,
infiltration state, last shot.

### Runtime

The suite is slow — ~22 min for one spec — because it waits on real coordinator
cycles. Run individual specs while iterating:

```bash
npm run test:ha -- vwc-day-cycle
```
