'use strict';

/**
 * RSS/Atom 阅读器按自己的域名解析内容里的 URL，正文中的根相对路径
 * （src="/2026/...）和仅锚点链接（href="#章节"）在阅读器里会变成
 * 裂图或死链。生成完毕后把 feed 里的这两类链接改写为绝对地址，
 * 站点页面 HTML 不受影响。
 */

hexo.extend.filter.register('after_generate', async function () {
  const { config, route } = this;
  const { feed } = config;
  if (!feed || !feed.path) return;

  const siteUrl = String(config.url || '').replace(/\/+$/, '');
  if (!siteUrl) return;

  const feedPaths = Array.isArray(feed.path) ? feed.path : [feed.path];

  for (const feedPath of feedPaths) {
    const stream = route.get(feedPath);
    if (!stream) continue;

    const xml = await new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
      stream.on('error', reject);
    });

    // 根相对资源/链接 -> 绝对地址；跳过协议相对地址（//cdn.example.com）
    let fixed = xml.replace(/\b(src|href)="\/(?!\/)/g, `$1="${siteUrl}/`);

    // 仅锚点链接（文章标题锚）-> 该篇文章绝对地址 + 锚点
    fixed = fixed.replace(/<entry>[\s\S]*?<\/entry>/g, entry => {
      const link = entry.match(/<link href="([^"]+)"/);
      if (!link) return entry;
      const base = link[1].replace(/\/+$/, '');
      return entry.replace(/\bhref="#([^"]*)"/g, (_, fragment) => `href="${base}/#${fragment}"`);
    });

    route.set(feedPath, fixed);
  }
});
