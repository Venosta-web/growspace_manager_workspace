"""Local, network-free AC Infinity entities for the Growspace E2E runtime.

This intentionally owns the real ``ac_infinity`` platform name. The card reads
that platform, each entity's translation key, and its shared device ID from the
frontend registries when resolving Port Pre-fill. The simulator is mounted only
in ``ha-dev`` and never ships with Growspace Manager itself.
"""

from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.typing import ConfigType

from .const import (
    CONF_DEVICE_KEY,
    CONF_DEVICE_NAME,
    CONF_ENTITIES,
    CONF_ENTITY_ID,
    CONF_TRANSLATION_KEY,
    DOMAIN,
)

PLATFORMS = (Platform.SELECT, Platform.NUMBER, Platform.TIME, Platform.SWITCH)

ENTITY_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_ENTITY_ID): cv.entity_id,
        vol.Required(CONF_TRANSLATION_KEY): cv.string,
        vol.Required(CONF_DEVICE_KEY): cv.string,
        vol.Required(CONF_DEVICE_NAME): cv.string,
    }
)

CONFIG_SCHEMA = vol.Schema(
    {DOMAIN: vol.Schema({vol.Required(CONF_ENTITIES): [ENTITY_SCHEMA]})},
    extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Import generated YAML into one local-only config entry.

    A config entry is required for Home Assistant to attach entities to the
    device registry. That relationship is part of the real AC Infinity
    contract consumed by Port Pre-fill.
    """
    hass.async_create_task(
        hass.config_entries.flow.async_init(
            DOMAIN,
            context={"source": "import"},
            data=config.get(DOMAIN, {}),
        ),
        "Import AC Infinity E2E simulator config",
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up locally writable AC Infinity entities from the imported entry."""
    registry = er.async_get(hass)
    for entity in entry.data[CONF_ENTITIES]:
        entity_id = entity[CONF_ENTITY_ID]
        if (
            (existing := registry.async_get(entity_id))
            and existing.platform == DOMAIN
            and existing.config_entry_id is None
        ):
            # Migrate registry rows created by the earlier YAML-platform form
            # of the simulator. Re-registration below attaches their devices.
            registry.async_remove(entity_id)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload all simulated AC Infinity entity platforms."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
