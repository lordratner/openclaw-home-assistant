"""OC-owned contract proof using an unchanged real HA companion checkout.

Disposable HA + loopback Gateway + synthetic model only. No hardware/audio or
provider calls. This proves ConversationResult intent, not microphone rearming.
"""
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile

ha_root = Path(os.environ["VOICE_PROOF_HA_ROOT"])
component_root = Path(os.environ.get("VOICE_PROOF_HA_PACKAGE_ROOT", str(ha_root)))
sys.path.insert(0, str(component_root))
from homeassistant import bootstrap, loader
from homeassistant.auth import auth_manager_from_config
from homeassistant.components import conversation
from homeassistant.config_entries import ConfigEntries
from homeassistant.const import CONF_LLM_HASS_API
from homeassistant.core import Context, HomeAssistant
from homeassistant.setup import async_setup_component
from custom_components.openclaw_voice.const import DOMAIN


async def main():
    with tempfile.TemporaryDirectory(prefix="ha-voice-continuation-") as directory:
        components = Path(directory) / "custom_components"
        components.mkdir()
        (components / DOMAIN).symlink_to(component_root / "custom_components" / DOMAIN, target_is_directory=True)
        hass = HomeAssistant(directory)
        loader.async_setup(hass)
        hass.config_entries = ConfigEntries(hass, {})
        assert await bootstrap.async_load_base_functionality(hass)
        hass.auth = await auth_manager_from_config(hass, [{"type": "homeassistant"}], [])
        results = []
        try:
            assert await async_setup_component(hass, DOMAIN, {})
            flow = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
            paired = await hass.config_entries.flow.async_configure(flow["flow_id"], {
                "url": os.environ["VOICE_PROOF_URL"], "pairing_code": os.environ["VOICE_PROOF_PAIRING_CODE"],
                "session_mode": "per_conversation"})
            assert paired["type"] == "create_entry"
            await hass.async_block_till_done()
            entry = paired["result"]

            async def ask(word, prior_id=None):
                return await conversation.async_converse(hass, "continuation-proof " + word,
                    prior_id, Context(), language="en", agent_id=entry.runtime_data.entities["conversation"].entity_id)

            first = await ask("clarify")
            assert first.continue_conversation is True
            assert first.response.speech["plain"]["speech"] == "Which room?"
            state = entry.runtime_data.modes.select(first.conversation_id, "per_conversation", entry.runtime_data.epoch)
            handle = state.handle
            # Same request must replay the true terminal decision without a new model invocation.
            retry_events = [event async for event in entry.runtime_data.client.turn(
                handle, "continuation-proof clarify", state.request_id)]
            assert retry_events[-1]["type"] == "done" and retry_events[-1]["continue_conversation"] is True
            results.append(first.continue_conversation)
            for word, expected in [("answer", False), ("clarify-again", True), ("stop", False), ("quoted", False)]:
                result = await ask(word, first.conversation_id)
                assert result.conversation_id == first.conversation_id
                assert result.continue_conversation is expected, (word, result.as_dict())
                assert entry.runtime_data.modes.select(first.conversation_id, "per_conversation", entry.runtime_data.epoch).handle == handle
                results.append(result.continue_conversation)

            # Turn policy must coexist with the native Assist lease, not replace its binding.
            options = await hass.config_entries.options.async_init(entry.entry_id)
            updated = await hass.config_entries.options.async_configure(options["flow_id"],
                {"session_mode": "per_conversation", CONF_LLM_HASS_API: ["assist"]})
            assert updated["type"] == "create_entry"
            await hass.async_block_till_done()
            native_question = await ask("clarify-native")
            assert native_question.continue_conversation is True
            results.append(native_question.continue_conversation)
            for word, expected in [("answer", False), ("stop", False)]:
                result = await ask(word, native_question.conversation_id)
                assert result.continue_conversation is expected
                results.append(result.continue_conversation)
            assert not entry.runtime_data.tasks
            assert await hass.config_entries.async_unload(entry.entry_id)
            print(json.dumps({"status": "passed", "decisions": results,
                "without_native_assist": True, "with_native_assist": True,
                "same_conversation_followup": True, "retry_decision_preserved": True,
                "stop_and_default_reset": True, "punctuation_not_control": True,
                "physical_listening_tested": False}))
        finally:
            await hass.async_stop(force=True)


async def bounded():
    async with asyncio.timeout(60):
        await main()


asyncio.run(bounded())
