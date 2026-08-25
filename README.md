# 熊吉的博客小站

基于 Hexo 8 和 AirCloud 主题构建。

## 本地开发

项目使用 Node.js 24 LTS，版本由 `.node-version` 固定。

```bash
npm ci
npm test
npm run server
```

- `npm test`：清理并生成站点，然后检查搜索、评论、元数据、站内链接、静态资源和外链安全属性。
- `npm run build`：清理并生成生产文件到 `public/`。
- `npm run server`：启动本地预览服务。

## 更新依赖

先检查并应用兼容版本更新，再运行完整测试：

```bash
npm outdated
npm update
npm test
```

主版本升级应逐个执行并检查发布说明，不在项目中安装或运行自动改写全部依赖的工具。

## Cloudflare Pages

Cloudflare Pages 会读取仓库根目录的 `.node-version`，无需在控制台重复维护 `NODE_VERSION`。构建命令使用 `npm run build`，输出目录为 `public`。
