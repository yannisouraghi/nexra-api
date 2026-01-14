// Quick script to register workers.dev subdomain
const { execSync } = require('child_process');

async function registerSubdomain() {
  try {
    // Get the OAuth token from wrangler
    const result = execSync('npx wrangler deploy --dry-run', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log('Dry run completed');
  } catch (e) {
    // Expected to fail
  }

  // Try to register via API
  const subdomain = 'nexra-api';
  const accountId = 'fa3b65b3fcf66e322d947b2f5907a64a';

  console.log(`\n=== ACTION REQUIRED ===`);
  console.log(`Please open this URL in your browser and register "${subdomain}" as your workers.dev subdomain:`);
  console.log(`https://dash.cloudflare.com/${accountId}/workers/onboarding`);
  console.log(`\nOnce registered, run: npm run deploy`);
}

registerSubdomain();
