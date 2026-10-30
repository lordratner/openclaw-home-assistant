# Compatibility and evidence boundaries

Candidate OCdev10 / HAdev6, protocol1.2. This is a development release, not a
universal-provider certification or a formal Home Assistant quality tier.

## Declared baseline

- OpenClaw public plugin SDK2026.10.3, Node24; no private bundle imports.
- HA2026.10.4, Python3.14.2+, using native config entries, Assist/ChatLog and STT/TTS.
- FFmpeg7.1.5 exercised on Linux for OC TTS normalization. Missing FFmpeg is
  tested as degraded TTS-only availability, not a total service failure.
- Finite-input streaming STT is optional and absent on stock OC2026.10.3.
  The canary's separately reviewed backport is not bundled or required for batch.

## Capability matrix

| Combination | Behavior | Evidence / limit |
| --- | --- | --- |
| Final-only native LLM | Project final answer once | Module regression |
| Streaming native LLM | Ordered text deltas, no repeated final snapshot | Module + disposable native model fixture |
| Model without tools | Text conversation remains possible | No promise of home control/follow-up tool support |
| Missing finite STT SDK | Native batch of the same selection or declared alternative | Contract regression, untouched input and private WAV cleanup |
| Unsupported finite provider/model | Batch primary or explicit batch alternative | Contract tests; native batch provider fixture |
| Native finite STT | Await all final input before dispatch | Optional injected-runtime fixture; initial provider backport separately tested |
| Native progressive TTS | Per-sentence progressive audio normalized once | Native ElevenLabs synthetic endpoint + decoder checks |
| Native buffered TTS | Automatic sentence-buffered capability downgrade | Native OpenAI synthetic endpoint + module tests |
| Existing buffered HA TTS + OC conversation | HA collects text and uses that engine | Real HA query/playback fixture; OC TTS deliberately unavailable |
| Missing OC normalizer/provider | Only that speech stage unavailable | Native HA independent-entity and loopback HTTP tests |
| Legacy HA/backend protocol1.0/1.1 | Same basic pipeline, no invented new capabilities | Legacy suite + v1→v2 migration tests |
| Protocol1.2 | Durable service identity, per-stage facts | Disposable real Gateway/HA pair and lifecycle tests |
| Changed URL / rotated pairing | Same entities, reject different backend/agent | Native flow/reauth/reconfigure/concurrent-duplicate tests |

The synthetic endpoints use real host provider adapters without contacting vendor
accounts. They prove API/transport behavior, not account entitlement, current
vendor service quality, model reasoning, physical audio or acoustic latency.

## Still required before broad public beta claims

- Clean installation by an unfamiliar operator, with normal artifact install,
  upgrade and rollback on declared stock host versions.
- Actual private-account/provider combinations not exercised by the fixtures;
  representative alternate/local engines and tool/non-tool model families.
- Real HTTPS/reverse-proxy stream buffering and supported device/codec choices.
- Physical multi-room load, native approval-required tools and interrupted/reboot
  recovery. Never replay uncertain device actions merely to pass a test.
- Public CI hassfest/HACS results, brand/distribution requirements and an honest
  measured coverage report. Source validators are not those certifications.

Keep live acceptance receipts separate from source-level test evidence. A prior
household canary does not certify these new candidate packages or another home.

## Intentional limits

One OC agent/profile is selected per plugin configuration. HA cannot retarget an
existing connection to arbitrary agents/sessions. Other OC tools are not magically
sandboxed by HA's exposed-entity policy; choose the native agent policy accordingly.
Only native Assist is exposed as the HA LLM API in this version.

Speech language declarations are explicit because the public host SDK lacks a
universal language catalog. No vendor-name guessing, unsupported auth translation,
model alias rewriting or silent local-to-cloud policy change is used to fill gaps.
Unavailable streaming is automatically downgraded; unavailable credentials or a
missing actual batch engine are actionable configuration errors, not a promise
that another provider will be invented.
