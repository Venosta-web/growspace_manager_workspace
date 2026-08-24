"""Config flow for the YAML-imported AC Infinity E2E simulator."""

from __future__ import annotations

from typing import Any

from homeassistant import config_entries

from .const import CONFIG_ENTRY_UNIQUE_ID, DOMAIN


class ACInfinitySimulatorConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Maintain the single local simulator config entry."""

    VERSION = 1

    async def async_step_import(self, import_data: dict[str, Any]):
        """Create or update the entry from the generated HA package."""
        await self.async_set_unique_id(CONFIG_ENTRY_UNIQUE_ID)
        self._abort_if_unique_id_configured(updates=import_data)
        return self.async_create_entry(
            title="E2E AC Infinity Simulator",
            data=import_data,
        )
