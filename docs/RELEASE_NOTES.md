# Nautex Community 0.3.14 — source release

Tag: `v0.3.14-source.1`. Repository: https://github.com/zpointai/nautex.

**The Windows installer is pending verification. No installer or native-materials archive is published with this source release.** GitHub's generated source archives contain code and are not executable installers.

- AGPL-3.0-only application source, attribution, full licence and corresponding-source build scripts.
- Separate Nautex Community installation and profile; no automatic adoption of private Nautex records.
- Empty first launch, local workspace/account creation, optional user-owned provider configuration and authorised catalogue import.
- Accurate requirements for all 17 navigation modules, Ask Nautex and Settings.
- Exact provider model IDs, setup, costs, privacy, explicit activation/removal and bounded failure handling.
- No owner keys, private business data, catalogue content or private Git history.
- Sanitised first-run and empty-catalogue screenshots; third-party notices, source/build manifests and the per-binary candidate inventory.

The Windows candidate passed build/type checks, nine focused tests and nine installed-application acceptance groups on a **developer host** with an isolated synthetic profile. Same-version reinstall, restart and uninstall/data preservation were tested there. No clean-machine, missing-VC++ prerequisite, cross-version upgrade or live-provider qualification is claimed.

Remaining binary gates include exact EDB library source/build correspondence, native static dependency/source and notice closure, vendor grants/revisions, and installer helper redistribution evidence. The candidate is unsigned; signing is optional. A clean supported Windows 11 x64 VM without developer tools, PostgreSQL or VC++ was unavailable. Follow [the precise pending procedure](CLEAN_WINDOWS_TEST.md).

The [release status](RELEASE_STATUS.md), [native review](THIRD_PARTY.md), [provider guide](PROVIDERS.md) and [module matrix](MODULE_REQUIREMENTS.md) describe evidence and limitations. The source tag is distinct from the earlier local `v0.3.14` candidate. Any future cleared installer will use a new tag at its exact final source commit, with regenerated matching artifacts and checksums.
