import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const failures = [];
if(config.main !== 'cloudflare/worker.mjs') failures.push('Production must use the authenticated Worker entrypoint.');
if(config.assets?.run_worker_first !== true) failures.push('Every static asset must pass through authentication.');
if(!config.account_id) failures.push('Set the Cloudflare account ID.');
if(!config.d1_databases?.[0]?.database_id || config.d1_databases[0].database_id.startsWith('00000000')) failures.push('Create D1 and set its database ID.');
if(!config.vars?.ACCESS_TEAM_DOMAIN || !config.vars?.ACCESS_AUD) failures.push('Configure the Cloudflare Access team domain and application audience.');
if(config.vars?.ALLOWED_EMAIL_DOMAIN !== 'garrison.se') failures.push('This deployment must be restricted to garrison.se.');
if(failures.length) { console.error('Deployment setup is incomplete:\n'+failures.map(x=>'• '+x).join('\n')); process.exit(1); }
console.log('Deployment configuration is ready.');
