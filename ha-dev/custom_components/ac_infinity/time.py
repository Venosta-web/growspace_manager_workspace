"""Writable AC Infinity schedule-time simulators."""

from __future__ import annotations

from datetime import time
from typing import Any

from homeassistant.components.time import TimeEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import CONF_ENTITIES
from .entity import ACInfinitySimEntityMixin


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create the generated time entities."""
    async_add_entities(
        ACInfinityTime(entity)
        for entity in entry.data[CONF_ENTITIES]
        if entity["entity_id"].startswith("time.")
    )


class ACInfinityTime(TimeEntity, RestoreEntity, ACInfinitySimEntityMixin):
    """Local equivalent of an upstream scheduled on/off time."""

    def __init__(self, config: dict[str, Any]) -> None:
        self._init_simulated_entity(config)
        self._attr_native_value = time(0, 0)

    async def async_added_to_hass(self) -> None:
        """Restore the last schedule value across HA restarts."""
        await super().async_added_to_hass()
        if last := await self.async_get_last_state():
            try:
                self._attr_native_value = time.fromisoformat(last.state)
            except ValueError:
                pass

    async def async_set_value(self, value: time) -> None:
        """Apply a schedule time locally."""
        self._attr_native_value = value
        self.async_write_ha_state()
