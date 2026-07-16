#!/usr/bin/env bash
# Runs on Render before each deploy (Pre-Deploy Command).
# Uses Render's internal DATABASE_URL — no Zscaler, no GitHub runner, no IP allow-list issues.
set -euo pipefail
echo "==> Prisma migrate deploy"
npx prisma migrate deploy
echo "==> Migrations applied"
