// Génère public/config.js à partir des variables d'environnement Netlify.
// Lancé automatiquement au build (voir netlify.toml). Aucun secret n'est versionné.
const fs = require('fs');
const cfg = `window.GAMEPORTAL_CONFIG = {
  SUPABASE_URL: ${JSON.stringify(process.env.SUPABASE_URL || '')},
  SUPABASE_ANON_KEY: ${JSON.stringify(process.env.SUPABASE_ANON_KEY || '')},
  PORTAL_NAME: ${JSON.stringify(process.env.PORTAL_NAME || 'EMBER ARCADE')}
};
`;
fs.writeFileSync('public/config.js', cfg);
console.log('config.js généré depuis les variables d\'environnement.');
