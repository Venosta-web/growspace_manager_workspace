"""Writable AC Infinity power and sunrise-duration simulators."""

from __future__ import annotations

from typing import Any

from homeassistant.components.number import NumberDeviceClass, NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import CONF_ENTITIES, CONF_TRANSLATION_KEY
from .entity import ACInfinitySimEntityMixin


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create the generated number entities."""
    async_add_entities(
        ACInfinityNumber(entity)
        for entity in entry.data[CONF_ENTITIES]
        if entity["entity_id"].startswith("number.")
    )


class ACInfinityNumber(NumberEntity, RestoreEntity, ACInfinitySimEntityMixin):
    """Local number matching upstream on-power or sunrise constraints."""

    _attr_native_step = 1

    def __init__(self, config: dict[str, Any]) -> None:
        self._init_simulated_entity(config)
        if config[CONF_TRANSLATION_KEY] == "sunrise_timer_minutes":
            self._attr_device_class = NumberDeviceClass.DURATION
            self._attr_mode = NumberMode.BOX
            self._attr_native_min_value = 0
            self._attr_native_max_value = 360
        else:
            self._attr_mode = NumberMode.AUTO
            self._attr_native_min_value = 0
            self._attr_native_max_value = 10
        self._attr_native_value = 0

    async def async_added_to_hass(self) -> None:
        """Restore the last numeric value across HA restarts."""
        await super().async_added_to_hass()
        if last := await self.async_get_last_state():
            try:
                value = float(last.state)
            except ValueError:
                return
            if self.native_min_value <= value <= self.native_max_value:
                self._attr_native_value = value

    async def async_set_native_value(self, value: float) -> None:
        """Apply a power or duration value locally."""
        if not self.native_min_value <= value <= self.native_max_value:
            raise ValueError(f"Value {value} is outside the simulated port range")
        self._attr_native_value = value
        self.async_write_ha_state()
