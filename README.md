hexo进行调试

```bash
npm run build
npm run server
```

检查当前有哪些包过期，如果有过期的，进行升级。  
参考资料：[How can I update each dependency in package.json to the latest version?](https://stackoverflow.com/questions/16073603/how-can-i-update-each-dependency-in-package-json-to-the-latest-version)

```bash
npm outdate
npm update
npm install -g npm-check-updates
ncu -u
npm install
npx npm-check-updates -u
npm install
```
