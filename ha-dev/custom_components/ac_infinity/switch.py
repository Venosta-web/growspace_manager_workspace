"""Writable AC Infinity sunrise switch simulator."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_ON
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
    """Create the generated switch entities."""
    async_add_entities(
        ACInfinitySwitch(entity)
        for entity in entry.data[CONF_ENTITIES]
        if entity["entity_id"].startswith("switch.")
    )


class ACInfinitySwitch(SwitchEntity, RestoreEntity, ACInfinitySimEntityMixin):
    """Local equivalent of the upstream sunrise-enabled switch."""

    def __init__(self, config: dict[str, Any]) -> None:
        self._init_simulated_entity(config)
        self._attr_is_on = False

    async def async_added_to_hass(self) -> None:
        """Restore sunrise enablement across HA restarts."""
        await super().async_added_to_hass()
        if last := await self.async_get_last_state():
            self._attr_is_on = last.state == STATE_ON

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Enable sunrise locally."""
        self._attr_is_on = True
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Disable sunrise locally."""
        self._attr_is_on = False
        self.async_write_ha_state()
