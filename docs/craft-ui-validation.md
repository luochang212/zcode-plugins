# Craft UI plugin validation

Validated on 2026-10-12. All nine plugin versions are `0.1.0`.

For the later `0.2.2` font and language changes, see [Chinese support validation](craft-chinese-validation.md).

| Plugin | Upstream version | Pinned source | Browser | Electron sandbox | Real import / Save |
| --- | --- | --- | --- | --- | --- |
| CADCraft | 0.5.0 | `c57879a5c8f5` | Pass | Pass | Not exercised |
| DeckCraft | 0.5.0 | `be14248577b9` | Pass | Pass | Content verified |
| DesignCraft | 0.6.0 | `835edae6594f` | Pass | Pass | Not exercised |
| GridCraft | 0.5.0 | `3926d21aa9a7` | Pass | Pass | Content verified |
| PdfCraft | 0.6.0 | `4e53e5ffbd11` | Pass | Pass | Not exercised |
| PhotoCraft | 0.7.0 | `649b1d5d92c0` | Pass | Pass | Not exercised |
| SoundCraft | 0.5.0 | `acb08ff5f00d` | Pass | Pass | Not exercised |
| VectorCraft | 0.9.0 | `fecea5390def` | Pass | Pass | Not exercised |
| WordCraft | 0.5.0 | `ad8c26442076` | Pass | Pass | Content verified |

All applications were compiled locally using Rust 1.95.0, the `wasm32-unknown-unknown`
target and Trunk 0.21.14. No upstream release binaries were used. PdfCraft and
DesignCraft apply the checked-in brand-artwork removal patches. Each snapshot records
its upstream commit, patch hashes, compilation hash and distributed asset hashes.

The browser checks use Chrome 151.0.7922.174 on macOS arm64, copied standalone plugin
installations, real compiled WASM, an official SDK AppBridge, and a CSP-constrained iframe.
Every application checks a single connection, resource responses below 8 MiB, successful
rendering, binary export, cancellation/retry and toolbar visibility. GridCraft checks CSV
import followed by a real Save to XLSX; WordCraft and DeckCraft import text/outline content
and verify it survives their real Save actions. A fresh browser process per application
releases GPU/audio resources between cases.

The Electron checks use Electron 41.0.3 and the actual sandbox registry/protocol/CSP from
ZCode source commit `9809692df6654b3dd0a7cfddc9b035032c987c2b` (those source files were clean).
They cover all nine applications on secure `zcode-sandbox` origins and isolated partitions,
with the normal application URL, actual WASM rendering and exact binary download bytes.
The harness supplies its own shell, bridge callbacks and test profile. It does not install
into the user's running ZCode profile or exercise the production native Save As dialog.

Repository checks passed:

- `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`.
- `pnpm lint`: zero errors; one existing warning in Blender's fake engine.
- `pnpm test`: 93 JS/Node tests across the root and plugin packages.
- `pnpm test:artifacts`: all 14 UI plugins started from isolated copied installations.
- `python3 scripts/validate.py`: all 23 marketplace plugins validated.
- `python3 -m unittest discover -s tests`: 12 tests, including deterministic ZIP generation
  and archive path safety. The expected inventory is derived from `marketplace.json`.
- `git diff --check`: upstream/generated formatting is declared in `.gitattributes`.

Run the browser and Electron commands in [the adapter README](../ui-plugins/craft-runtime/README.md)
to reproduce the runtime checks. Their JSON results, screenshots and generated test profiles
are written to `.craft-cache/` and are intentionally not committed.

These are UI integrations. Native engine automation, every import/export format, full font
coverage, OCR models, native audio plugins, printing, clipboard behavior and unsaved document
recovery have not been exhaustively tested. The workspace import cap is 128 MiB and the host
export cap is 50 MiB. See each plugin's bilingual README for invocation and limitations.
