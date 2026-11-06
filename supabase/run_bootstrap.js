const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const sql = fs.readFileSync(path.join(__dirname, 'bootstrap_admin.sql'), 'utf8');
const password = process.env.SUPABASE_DB_PASSWORD;
const projectRef = 'lnywoqpmdsrsyvsbattw';

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
  `postgresql://postgres:${encoded}@db.${projectRef}.supabase.co:6543/postgres`,
];

async function main() {
  for (const connectionString of candidates) {
    const safe = connectionString.replaceAll(password, '***').replaceAll(encoded, '***');
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });

    try {
      console.log('Trying', safe);
      await client.connect();
      console.log('Connected');
      await client.query(sql);
      const { rows } = await client.query(
        `select username, user_id, user_role, email, status
         from public.users
         where user_id = $1 or email = $2`,
        ['Brian_Bruce_1010', 'jeannie16nguyen@gmail.com'],
      );
      console.log('ADMIN_ROW', JSON.stringify(rows, null, 2));
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
