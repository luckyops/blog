---
title: metabase部署文档
date: 2018-11-15 16:31:28
tags:
---
#### 前言
metabase是一个BI的图表工具，主要需求是连接相关的mysql，可以通过docker进行部署。
需要升级 4.10以上内核，需要安装docker服务。
#### 安装准备
##### Linux升级内核

``` bash
rpm --import https://www.elrepo.org/RPM-GPG-KEY-elrepo.org
rpm -Uvh http://www.elrepo.org/elrepo-release-7.0-3.el7.elrepo.noarch.rpm
yum --enablerepo=elrepo-kernel install kernel-ml -y

awk -F\' '$1=="menuentry " {print i++ " : " $2}' /etc/grub2.cfg
grub2-set-default 0
cat /boot/grub2/grubenv |grep saved
grub2-mkconfig -o /boot/grub2/grub.cfg

```

#####  安装docker服务

``` bash 
curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun
```

#####  启动docker服务

``` bash 
systemctl enable docker
systemctl start docker
```

###### 拷贝metabase里面的默认数据库
```
mkdir -p /home/server/metabase
docker run -d -name metabase metabase/metabase
docker cp metabase:/metabase.db/metabase.db.mv.db  .
mv metabase.db.mv.db /home/server/metabase/.
```

#####  保存一个脚本，里面是metabase的启动命令

```bash
docker rm -f metabase
docker run --name metabase -p 3000:3000 \
    -v /home/server/metabase/metabase.db.mv.db:/metabase.db/metabase.db.mv.db \ 
    -d  metabase/metabase:latest
```
#####  在最外端做好nginx转发，以及配置好nginx证书即可。


[metabase Github项目地址](https://github.com/metabase/metabase)