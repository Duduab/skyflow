-- Run this ONCE as a PostgreSQL superuser (creates role + database for SkyFlow).
--
-- Corporate Mac / GSSAPI / "CORP...AMDOCS" errors — use IPv4 + disable GSS:
--   export PGGSSENCMODE=disable
--   psql -h 127.0.0.1 -p 5432 -U postgres -f scripts/init-db.sql
--
-- Postgres.app often uses your macOS username instead of postgres:
--   psql -h 127.0.0.1 -p 5432 -U "$(whoami)" -d postgres -f scripts/init-db.sql

CREATE USER skyflow WITH PASSWORD 'skyflow';

CREATE DATABASE skyflow OWNER skyflow;

GRANT ALL PRIVILEGES ON DATABASE skyflow TO skyflow;

\c skyflow

GRANT ALL ON SCHEMA public TO skyflow;
ALTER SCHEMA public OWNER TO skyflow;
