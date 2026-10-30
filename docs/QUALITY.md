# Home Assistant quality and release checklist

This pair uses HA's standard provider entities and configuration lifecycle. The
[official quality scale](https://contributors.home-assistant.io/core/quality-scale/rules/)
is a useful review benchmark. This custom integration does **not** claim a tier.

## Implemented and locally checked

- Native UI pairing/config/options/reauth/reconfigure; no YAML or internal storage
  edits needed. Fields have selectors, labels and descriptions.
- Connection data and preference options separated; v1 history-default migration
  preserves explicit existing options, credentials and entity IDs.
- Stable service/profile identity, duplicate/concurrent-flow guards and cleanup
  of unused newly issued credentials. Wrong backend/agent moves fail closed.
- Native platform setup/unload, runtime_data, shared aiohttp session and coordinator.
  Connection unavailability and stage unavailability are separate.
- Actions registered in async_setup; failures raise HA exceptions; response data
  distinguishes a requested playback from actual acoustic delivery.
- Native conversation streaming/final output, STT metadata validation and both
  streaming/buffered TTS entrypoints. Existing HA speech engines remain independent.
- has_entity_name, unique IDs within entries, translated entity names and
  translatable user-visible exceptions/config descriptions/action labels.
- Native Assist tool/context/exposure execution and opt-in control. No change to
  preferred pipelines or hidden-entity permissions.
- Allowlisted diagnostics, monotonic timing, bounded histories and sanitized
  failure receipts; no general transcript/audio/credential logging.
- iot_class is local_poll: OC is the connected service, capability health polls
  every30s, and request streams do not constitute unsolicited state push.
- Offline metadata/syntax/translation/public-SDK/package validators are included.
  Runtime dependencies remain native HA/OC; no vendor SDK was added.

## Automated validation surfaces

HA repository:

```sh
.venv/bin/python scripts/validate_package.py
.venv/bin/python -m pytest -q
```

OC repository:

```sh
npm run check
npm test
npm run test:native-pair
```

The paired proof uses a disposable real Gateway/native HA with synthetic providers
and no live credentials/devices. Archive verification compares every deployed
source byte and can run the same proof against extracted packages.

CI workflows define module/package checks plus official hassfest and HACS jobs.
Adding workflow files is not evidence they ran. Both repositories need their
normal publication/CI review; no push or public submission is part of local work.

## Not claimed / release gates

- Formal Bronze/Silver/Gold/Platinum tier approval, universal languages or every
  LLM/provider/harness/device combination.
- Official measured >95% coverage or full config-flow branch coverage merely
  because tests pass. A stdlib executable-line probe may help find gaps locally;
  it is not coverage.py/branch certification. Add fault tests for relevant gaps
  rather than mirroring implementation to inflate a percentage.
- Strict mypy typing over all legacy source, automatic service discovery,
  brand-catalog acceptance or public HACS listing. Reconfigure is provided even
  without network discovery; optional speech is not treated as setup failure.
- Acoustic latency or confirmation of physical actuation based on HTTP timings.
- Uninterrupted completion across code replacement, or guaranteed cancellation
  of providers that have no native abort contract.

See [compatibility](COMPATIBILITY.md) for remaining real-platform/physical gates,
and [product setup](PRODUCT.md) for the supported user workflow.
