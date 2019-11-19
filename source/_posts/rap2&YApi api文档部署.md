---
title: rap2&YApi api文档部署
date: 2019-07-08 18:15:48
tags:
cover_img:
feature_img:
---

这两天一直在做这个api文档的部署，折腾了两天。
两天下来，这东西也总算搞定了，记录一下，网上有不少的部署文档，结果都是坑。
我用的是CentOS+docker+docker-compose做的部署。

项目来源：https://github.com/taomaree/docker-rap2

```bash
mkdir -p /app/docker-rap2
cd /app/docker-rap2
wget -c https://github.com/taomaree/docker-rap2/raw/master/docker-compose.yml
## change default http port 38080 to other port, if needed
docker-compose up -d
```

这个是目前这么多文档里面，我唯一一个成功部署的。
再装一个NGINX，用NGINX做一下proxy_pass就好了。
主要是这些文档太多，靠谱的还基本没有，于是我就fork了一个，做一个备份，希望以后不会用到。
觉得国内的开源和国外的开源还是差距很明显，这个也算是阿里的一个项目，大公司搞得文档写成这样，也挺无语的。
按照文档都不能成功部署，机器都被我重置了两次，踩了无数的坑，真实无语。


前面RAP2部署完毕以后，开发觉得不是很好用，于是又搞了个YApi，基本满足了需求。
YApi的项目地址
https://github.com/YMFE/yapi
YApi通过docker-compose部署的项目地址
https://github.com/jinfeijie/yapi
这个写的比较全，直接git clone下来以后，用docker-compose拉起，再配置一下NGINX转发就好了。
目前使用的是YApi来做接口管理，总的体验也是比较好的。