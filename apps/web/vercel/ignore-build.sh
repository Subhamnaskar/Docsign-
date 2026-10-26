#!/usr/bin/env bash
# Vercel "Ignored Build Step": exit 0 skips this deploy, anything else builds.
# Skips only when nothing the website is built from changed (e.g. a push that
# touches just the mobile app or docs). If the comparison fails, it builds.
cd ../..
base="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
git diff --quiet "$base" HEAD -- apps/web apps/api package.json package-lock.json && exit 0
exit 1
