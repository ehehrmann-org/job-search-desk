#!/usr/bin/env bash
# Save changes to the private copy: commit and push to main, retrying when another save
# (the daily scan, the daily run) landed first.
#
#   bash desk/save.sh "<message>"         commits profile/ only
#   bash desk/save.sh --all "<message>"   commits every change (after "update career tool")
#
# Prints "saved" on success. On failure prints why and exits 1; nothing is lost, the
# commit stays local and the next save pushes it.
set -u
cd "$(dirname "$0")/.." || exit 1
scope=profile
if [ "${1:-}" = "--all" ]; then scope=.; shift; fi
msg="${1:-update}"
id=()
if [ -z "$(git config user.email || true)" ]; then
  id=(-c user.name="job-search-desk-bot" -c user.email="actions@users.noreply.github.com")
fi
git add -A -- "$scope"
git "${id[@]}" commit -qm "$msg" >/dev/null 2>&1 || true
err=""
for i in 1 2 3; do
  if err=$(git "${id[@]}" pull -q --rebase origin main 2>&1) && err=$(git push -q origin HEAD:main 2>&1); then
    echo "saved"; exit 0
  fi
  git rebase --abort >/dev/null 2>&1 || true
  sleep $((i * 5))
done
echo "save failed: $(echo "$err" | tail -n 1)"
exit 1
