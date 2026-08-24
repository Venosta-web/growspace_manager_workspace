"""Shared entity identity for the AC Infinity E2E simulator."""

from __future__ import annotations

from typing import Any

from homeassistant.helpers.device_registry import DeviceInfo

from .const import (
    CONF_DEVICE_KEY,
    CONF_DEVICE_NAME,
    CONF_ENTITY_ID,
    CONF_TRANSLATION_KEY,
    DOMAIN,
    MANUFACTURER,
    MODEL,
)


class ACInfinitySimEntityMixin:
    """Give every simulated entity real-integration registry metadata."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def _init_simulated_entity(self, config: dict[str, Any]) -> None:
        entity_id = config[CONF_ENTITY_ID]
        object_id = entity_id.split(".", 1)[1]
        self.entity_id = entity_id
        self._attr_suggested_object_id = object_id
        self._attr_unique_id = f"e2e_ac_infinity_{object_id}"
        self._attr_translation_key = config[CONF_TRANSLATION_KEY]
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, config[CONF_DEVICE_KEY])},
            name=config[CONF_DEVICE_NAME],
            manufacturer=MANUFACTURER,
            model=MODEL,
        )
