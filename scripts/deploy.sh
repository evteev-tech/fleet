#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH="main"
PM2_APP="matizi"

cd "$REPO_DIR"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "❌ Not a git repo: $REPO_DIR" >&2
  exit 1
fi

current_branch="$(git branch --show-current)"
if [ "$current_branch" != "$BRANCH" ]; then
  git fetch origin "$BRANCH"
  git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
fi

git pull --rebase origin "$BRANCH"

if [ -f backend/package.json ]; then
  (cd backend && npm install --omit=dev)
fi

pm2 restart "$PM2_APP" --update-env

echo "✅ Задеплоено ($BRANCH @ $(git rev-parse --short HEAD))"
echo "   Backend: PM2 перезапущен"
echo "   Frontend: обновлён через git pull (nginx читает напрямую)"
