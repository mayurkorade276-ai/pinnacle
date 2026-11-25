import { supabaseAdmin } from './supabase-server';

console.log('Test started...');

async function testDatabase() {
  console.log('Connecting to Supabase...');

  const { data, error } = await supabaseAdmin
    .from('patient_profiles')
    .select('uid')
    .limit(1);

  if (error) {
    console.error('Database error:', error);
  } else {
    console.log('Connection successful!');
    console.log('Data:', data);
  }
}

testDatabase().catch(console.error);