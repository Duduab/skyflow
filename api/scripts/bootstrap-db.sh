#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$ROOT/scripts/init-db.sql"

# Avoid corporate/mac Kerberos (GSSAPI) issues when talking to local Postgres
export PGGSSENCMODE="${PGGSSENCMODE:-disable}"

PGHOST="${PGHOST:-127.0.0.1}"

echo "SkyFlow DB bootstrap — connects as PostgreSQL superuser and creates role/database 'skyflow'."
echo ""
echo "Usage:"
echo "  export PG_SUPERUSER=postgres          # or postgres / $(whoami) on Postgres.app"
echo "  export PGPASSWORD='your_admin_password' # if required"
echo "  bash scripts/bootstrap-db.sh"
echo ""

PG_SUPERUSER="${PG_SUPERUSER:-postgres}"

psql -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PG_SUPERUSER" -f "$SQL"

echo ""
echo "Done. Ensure api/.env has:"
echo '  DATABASE_URL="postgresql://skyflow:skyflow@127.0.0.1:5432/skyflow"'
echo "Then:"
echo "  export PGGSSENCMODE=disable"
echo "  cd api && npx prisma migrate deploy && npm run prisma:seed"
