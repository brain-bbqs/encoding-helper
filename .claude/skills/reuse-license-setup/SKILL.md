---
name: reuse-license-setup
description: Conventions for setting up or auditing REUSE license compliance (REUSE.toml, LICENSES/, root LICENSE, and the pre-commit `reuse` hook) in this repo. Use this whenever adding/changing REUSE.toml, the LICENSES/ directory, the root LICENSE file, the project's SPDX license identifier, or the `reuse` pre-commit hook — including when copying this setup into a new or sibling Center for Open Neuroscience / STAMPED repo.
---

# REUSE license setup

This repo follows the [REUSE specification](https://reuse.software/spec/) for
machine-readable license compliance, verified by `reuse lint` and enforced via
the `reuse` pre-commit hook (see `.pre-commit-config.yaml`).

The standard layout:

- `REUSE.toml` — declares the project-wide SPDX license and copyright via an
  aggregate annotation (`path = "**"`), so individual files don't need
  per-file SPDX headers.
- `LICENSES/<SPDX-ID>.txt` — the full license text (e.g. `LICENSES/MIT.txt`).
- `LICENSE` — a root-level copy of the license, for humans and tools (GitHub,
  npm, etc.) that look there instead of `LICENSES/`.

## Key decision: root LICENSE is a real file, not a symlink

Some sibling repos (e.g. `stamped-principles/stamped-checklist`) symlink the
root `LICENSE` to `LICENSES/<SPDX-ID>.txt`. **Don't copy that pattern here.**
Instead, make `LICENSE` a plain duplicate:

```bash
cp LICENSES/MIT.txt LICENSE
```

Reason: GitHub's blob viewer doesn't render a symlink's target content — it
just shows the file as a symlink — and this also confuses the repo sidebar's
license-detection widget, which expects to read actual license text from
`LICENSE`. `reuse lint` is satisfied either way (it doesn't care whether
`LICENSE` is a symlink or a copy), so the plain-file copy costs nothing and
renders correctly everywhere.

The tradeoff is that `LICENSE` and `LICENSES/<SPDX-ID>.txt` can drift out of
sync since they're no longer the same file. In practice this is a non-issue —
license text essentially never changes after a project picks a license — but
if the SPDX identifier ever changes, update both files together.

## Checklist when setting this up in a repo

1. Add `REUSE.toml` with the project's SPDX license identifier and copyright
   holder (aggregate annotation over `path = "**"`).
2. Add `LICENSES/<SPDX-ID>.txt` with the full canonical license text.
3. Add a root `LICENSE` as a **copy** (not symlink) of that same text.
4. Add the `reuse` hook (from `https://github.com/fsfe/reuse-tool`) to
   `.pre-commit-config.yaml`.
5. Run `reuse lint` to confirm compliance before committing.
