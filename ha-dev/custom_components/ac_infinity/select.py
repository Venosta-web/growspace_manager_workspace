"""Writable AC Infinity Active Mode select simulators."""

from __future__ import annotations

from typing import Any

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import CONF_ENTITIES, MODE_OPTIONS
from .entity import ACInfinitySimEntityMixin


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create the generated select entities."""
    async_add_entities(
        ACInfinityModeSelect(entity)
        for entity in entry.data[CONF_ENTITIES]
        if entity["entity_id"].startswith("select.")
    )


class ACInfinityModeSelect(SelectEntity, RestoreEntity, ACInfinitySimEntityMixin):
    """Network-free equivalent of an upstream Active Mode select."""

    _attr_options = MODE_OPTIONS

    def __init__(self, config: dict[str, Any]) -> None:
        self._init_simulated_entity(config)
        self._attr_current_option = "Off"

    async def async_added_to_hass(self) -> None:
        """Restore the last selected mode across HA restarts."""
        await super().async_added_to_hass()
        if (last := await self.async_get_last_state()) and last.state in MODE_OPTIONS:
            self._attr_current_option = last.state

    async def async_select_option(self, option: str) -> None:
        """Apply a mode locally with no cloud service."""
        if option not in MODE_OPTIONS:
            raise ValueError(f"Unsupported AC Infinity mode: {option}")
        self._attr_current_option = option
        self.async_write_ha_state()
