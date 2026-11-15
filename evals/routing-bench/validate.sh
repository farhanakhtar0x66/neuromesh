#!/bin/sh
# Validate every checker: a reference answer must score full marks, an empty workspace must not.
# Covers the original 15 prompts (tasks/) and the held-out 15 (held-out/tasks/). No model calls.
set -u
here=$(cd "$(dirname "$0")" && pwd)
fail=0
for t in "$here"/tasks/*/ "$here"/held-out/tasks/*/; do
  slug=$(basename "$t")
  ref=$(cd "$t/../../reference/$slug" && pwd)
  set_name=regression
  case "$t" in */held-out/*) set_name=held-out ;; esac
  for mode in reference empty; do
    w=$(mktemp -d)
    cp -R "$t/seed/." "$w/"
    [ "$mode" = reference ] && cp -R "$ref/." "$w/"
    cp -R "$t/hidden" "$w/hidden"
    out=$(cd "$w" && python3 -I hidden/check.py 2>&1); code=$?
    vis=$(cd "$w" && python3 -I .bench/format-check >/dev/null 2>&1; echo $?)
    score=$(printf '%s\n' "$out" | grep '^SCORE' | tail -1)
    if [ "$mode" = reference ] && { [ $code -ne 0 ] || [ "$vis" -ne 0 ]; }; then fail=1; echo "BAD  [$set_name] $slug reference: $score visible=$vis"; printf '%s\n' "$out" | grep FAIL; fi
    if [ "$mode" = empty ] && [ $code -eq 0 ]; then fail=1; echo "BAD  [$set_name] $slug empty workspace passes: $score"; fi
    [ "$mode" = reference ] && echo "ok   [$set_name] $slug reference $score, visible gate passes"
    [ "$mode" = empty ] && echo "ok   [$set_name] $slug empty     $score"
    rm -rf "$w"
  done
done
exit $fail
