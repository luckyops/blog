const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const projectRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(projectRoot, 'public');
const config = fs.readFileSync(path.join(projectRoot, '_config.yml'), 'utf8');
const siteUrl = config.match(/^url:\s*(\S+)\s*$/m)?.[1]?.replace(/\/$/, '');

if (!siteUrl) {
  throw new Error('Unable to read site URL from _config.yml');
}

const index = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
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

function listHtmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listHtmlFiles(entryPath) : entryPath.endsWith('.html') ? [entryPath] : [];
  });
}

function readPublicPath(urlPath) {
  let outputPath = path.join(publicRoot, decodeURIComponent(urlPath));
  if (urlPath.endsWith('/') || (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory())) {
    outputPath = path.join(outputPath, 'index.html');
  }
  return outputPath;
}

const htmlFiles = listHtmlFiles(publicRoot);
const brokenLocalReferences = [];
const unsafeExternalLinks = [];

for (const htmlFile of htmlFiles) {
  const html = fs.readFileSync(htmlFile, 'utf8');

  for (const match of html.matchAll(/\b(?:href|src|data-src)="([^"]+)"/g)) {
    const reference = match[1];
    if (!reference.startsWith('/') || reference.startsWith('//')) continue;

    const urlPath = new URL(reference, siteUrl).pathname;
    if (!fs.existsSync(readPublicPath(urlPath))) {
      brokenLocalReferences.push(`${path.relative(publicRoot, htmlFile)} -> ${reference}`);
    }
  }

  for (const match of html.matchAll(/<a\b[^>]*\bhref="https?:\/\/[^\"]+"[^>]*>/g)) {
    const anchor = match[0];
    if (!/\btarget="_blank"/.test(anchor) || !/\brel="[^"]*\bnoopener\b[^"]*"/.test(anchor)) {
      unsafeExternalLinks.push(`${path.relative(publicRoot, htmlFile)} -> ${anchor}`);
    }
  }
}

assert.deepEqual(brokenLocalReferences, [], `Broken local references:\n${brokenLocalReferences.join('\n')}`);
assert.deepEqual(unsafeExternalLinks, [], `Unsafe external links:\n${unsafeExternalLinks.join('\n')}`);

assert.match(index, /<html lang="zh-CN">/);
assert.match(index, /<meta name="keywords" content="熊吉">/);

// Feed 内容必须在 RSS 阅读器中可独立解析：不允许根相对或仅锚点的链接
const feedPath = path.join(publicRoot, 'atom.xml');
assert.ok(fs.existsSync(feedPath), 'Feed is enabled but public/atom.xml was not generated');
const feed = fs.readFileSync(feedPath, 'utf8');
const relativeFeedUrls = [...feed.matchAll(/\b(?:src|href)="(\/[^"]*|#[^"]*)"/g)].map((match) => match[1]);
assert.deepEqual(
  relativeFeedUrls,
  [],
  `Feed contains non-absolute URLs that break in RSS readers:\n${relativeFeedUrls.slice(0, 10).join('\n')}`,
);

const searchPath = path.join(publicRoot, 'search.json');
assert.ok(fs.existsSync(searchPath), 'Search is enabled but public/search.json was not generated');
const searchEntries = JSON.parse(fs.readFileSync(searchPath, 'utf8'));
assert.ok(Array.isArray(searchEntries) && searchEntries.length > 0, 'Search index contains no posts');

const newestPostPath = readPublicPath(new URL(relativePostLinks[0], siteUrl).pathname);
const newestPost = fs.readFileSync(newestPostPath, 'utf8');
assert.match(newestPost, /<script src="https:\/\/giscus\.app\/client\.js"/);
assert.match(newestPost, /data-repo="luckyops\/blog"/);
assert.match(newestPost, /data-mapping="pathname"/);

console.log(
  `OK: ${htmlFiles.length} HTML files, ${relativePostLinks.length} homepage post links, search, metadata, assets, external links, and Giscus`,
);
