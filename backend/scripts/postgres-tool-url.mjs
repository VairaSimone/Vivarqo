#!/usr/bin/env node
import process from "node:process";

const input = process.env.DATABASE_URL;
if (!input) {
  process.stderr.write("DATABASE_URL is required.\n");
  process.exit(2);
}
let url;
try { url = new URL(input); } catch {
  process.stderr.write("DATABASE_URL is not a valid URL.\n");
  process.exit(2);
}
if (!["postgres:", "postgresql:"].includes(url.protocol)) {
  process.stderr.write("DATABASE_URL must use postgres:// or postgresql://.\n");
  process.exit(2);
}
for (const parameter of ["schema", "connection_limit", "pool_timeout", "pgbouncer", "statement_cache_size"]) {
  url.searchParams.delete(parameter);
}
const index = process.argv.indexOf("--database");
if (index >= 0) {
  const name = process.argv[index + 1];
  if (!name || !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/.test(name)) {
    process.stderr.write("Invalid database name.\n");
    process.exit(2);
  }
  url.pathname = "/" + encodeURIComponent(name);
}
process.stdout.write(url.toString());
