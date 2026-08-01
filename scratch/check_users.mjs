import { readFileSync } from 'fs';

// Read .env file to get Supabase credentials
const envContent = readFileSync('.env', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*?)\s*$/);
  if (match) {
    env[match[1]] = match[2];
  }
});

const supabaseUrl = env.SUPABASE_URL.trim();
const supabaseAnonKey = env.SUPABASE_ANON_KEY.trim();

async function querySupabase(path) {
  const url = `${supabaseUrl}/rest/v1/${path}`;
  const response = await fetch(url, {
    headers: {
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    return `Error: ${response.status} ${response.statusText}`;
  }
  return response.json();
}

async function check() {
  console.log('Querying reading_plans...');
  const plans = await querySupabase('reading_plans?limit=5');
  console.log('Plans response:', plans);

  console.log('Querying reading_logs...');
  const logs = await querySupabase('reading_logs?limit=5');
  console.log('Logs response:', logs);
}

check().catch(console.error);
