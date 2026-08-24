const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const config = fs.readFileSync(path.join(projectRoot, '_config.yml'), 'utf8');
const siteUrl = config.match(/^url:\s*(\S+)\s*$/m)?.[1]?.replace(/\/$/, '');

if (!siteUrl) {
  throw new Error('Unable to read site URL from _config.yml');
}

const index = fs.readFileSync(path.join(projectRoot, 'public', 'index.html'), 'utf8');
const links = [...index.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
const absoluteInternalLinks = links.filter((href) => href.startsWith(`${siteUrl}/`));
const relativePostLinks = links.filter((href) => /^\/\d{4}\/\d{2}\/\d{2}\//.test(href));

if (absoluteInternalLinks.length > 0) {
  throw new Error(
    `Homepage contains production-only internal links:\n${absoluteInternalLinks.join('\n')}`,
  );
}

if (relativePostLinks.length === 0) {
  throw new Error('Homepage contains no root-relative post links');
}

console.log(`OK: ${relativePostLinks.length} homepage post links are root-relative`);
