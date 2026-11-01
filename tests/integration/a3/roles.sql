-- ONLY for the disposable A3 database; test credentials must never be deployed.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'a3-ci-auth-only';
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO service_role, anon, authenticated;
