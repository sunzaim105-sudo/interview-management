/**
 * Apply a SQL file against the Supabase Postgres database.
 * Usage (PowerShell):
 *   $env:SUPABASE_DB_PASSWORD="..."
 *   node supabase/run_sql_file.js gmail_central_inbox.sql
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: node supabase/run_sql_file.js <file.sql>');
  process.exit(1);
}

const sqlPath = path.isAbsolute(fileArg)
  ? fileArg
  : path.join(__dirname, fileArg);
const sql = fs.readFileSync(sqlPath, 'utf8');
const password = process.env.SUPABASE_DB_PASSWORD;
const projectRef = process.env.SUPABASE_PROJECT_REF || 'lnywoqpmdsrsyvsbattw';

if (!password) {
  console.error('Missing SUPABASE_DB_PASSWORD');
  process.exit(1);
}

const encoded = encodeURIComponent(password);
const candidates = [
  `postgresql://postgres:${encoded}@db.${projectRef}.supabase.co:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-us-east-2.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-us-west-2.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-1-us-east-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
  `postgresql://postgres:${encoded}@db.${projectRef}.supabase.co:6543/postgres`,
];

async function main() {
  for (const connectionString of candidates) {
    const safe = connectionString
      .replaceAll(password, '***')
      .replaceAll(encoded, '***');
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 12000,
    });

    try {
      console.log('Trying', safe);
      await client.connect();
      console.log('Connected');
      await client.query(sql);
      console.log('Applied', path.basename(sqlPath));
      await client.end();
      return;
    } catch (error) {
      console.log('Failed:', error.message);
      try {
        await client.end();
      } catch {
        // ignore
      }
    }
  }

  console.error('Could not connect with provided password on known hosts.');
  process.exit(1);
}

main();
