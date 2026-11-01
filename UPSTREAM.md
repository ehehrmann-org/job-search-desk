# Upstream base

This repository is built on career-ops by Santiago Fernandez (santifer), MIT license (see LICENSE).

- Upstream: https://github.com/santifer/career-ops
- Imported release: career-ops-v1.36.0
- Upstream commit: 26384e5348288189358c64bb859543671e19a916
- Imported: 2026-10-10

Not imported: upstream's .github folder (its 27 maintainer workflows would run in this repository and use its Actions minutes).

Changed from upstream: package.json declares exact dependency versions (plus an `overrides` pin for js-yaml's one dependency, argparse) instead of `^` ranges. Upstream gitignores package-lock.json and every install here runs `npm install --ignore-scripts` without one, so exact pins are what keeps the daily scan and "update career tool" on reviewed versions. When importing a new upstream release, keep the pins and move them deliberately.

The "career-ops" name is governed by upstream's TRADEMARK.md and is not used as this product's name.
Our own additions live in their own folders and are listed in the friend edition spec.
