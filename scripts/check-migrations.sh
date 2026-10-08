#!/usr/bin/env bash
# Applies all migrations + RLS tests to a throwaway local PostgreSQL 15+/16.
# Usage: npm run db:check   (requires initdb/pg_ctl on PATH or PGBIN set)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
DATA="$(mktemp -d)"
PORT="${PGPORT_CHECK:-54329}"
RUN_AS=""
if [ "$(id -u)" = "0" ]; then RUN_AS="sudo -u postgres"; chown postgres "$DATA"; fi
$RUN_AS "$PGBIN/initdb" -D "$DATA" -A trust -U postgres >/dev/null
$RUN_AS "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=''" -l "$DATA/log" start >/dev/null
trap '$RUN_AS "$PGBIN/pg_ctl" -D "$DATA" stop -m immediate >/dev/null; rm -rf "$DATA"' EXIT
PSQL="psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database ain_check" >/dev/null
$PSQL -d ain_check -c "create extension if not exists pgcrypto" >/dev/null
$PSQL -d ain_check -f "$ROOT/supabase/tests/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  $PSQL -d ain_check -f "$f" >/dev/null
done
if [ -f "$ROOT/supabase/seed.sql" ]; then $PSQL -d ain_check -f "$ROOT/supabase/seed.sql" >/dev/null; fi
for t in "$ROOT"/supabase/tests/*_test.sql; do
  [ -e "$t" ] || continue
  echo "running $(basename "$t")"
  $PSQL -d ain_check -f "$t"
done
echo "migrations OK"
