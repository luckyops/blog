---
title: zabbix监控部署汇总
date: 2018-09-06 17:15:32
tags:
---

### 前言
zabbix属于传统的服务器监控软件，优点是angent采集数据汇总到服务器，而且可以对接grafana进行状态输出。可以对接邮件报警、微信报警、短信报警，及时获取服务器报警状态。以及可以做一部分简单的服务自动恢复。我在这里主要记录一下我做了哪些对LNMP应用的对接和自动恢复、邮件报警等，不对zabbix软件本身做过多介绍。
#### 一、安装zabbix服务
##### 1 通过docker的方式部署zabbix服务 
首先在服务器安装docker，然后从服务器Pull下来docker镜像，快速拉起zabbix server。
```
# 安装docker服务
$ curl -fsSL get.docker.com -o get-docker.sh
$ sudo sh get-docker.sh
$ systemctl start docker
$ systemctl enable docker
```
##### 1.1 下载zabbix server镜像   
1、zabbix前端   镜像名：zabbix/zabbix-web-nginx-mysql:latest  
2、zabbix服务端 镜像名：zabbix-server-mysql:latest  
3、数据库 镜像名：mariadb:latest
```
docker pull zabbix/zabbix-server-mysql:latest;
docker pull zabbix/zabbix-web-nginx-mysql:latest;
docker pull mariadb:latest;
```
执行完以上命令后，镜像就会被下载好了，我创建了三个脚本进行拉起镜像。   
##### 1.2 执行脚本拉起zabbix服务
```
# filename:mariadb.sh
docker rm -f mariadb-zabbix
docker run --name mariadb-zabbix \
       -v /data/mysql:/var/lib/mysql \ 
       -e MYSQL_ROOT_PASSWORD=123456 \  
       -d mariadb:latest

# filename:run-zabbix-server.sh
docker rm -f zabbix-server
docker run --name zabbix-server -t \
      -e DB_SERVER_HOST="mariadb-zabbix" \
      -e MYSQL_DATABASE="zabbix" \
      -e MYSQL_USER="zabbix" \
      -e MYSQL_PASSWORD="zabbix" \
      -e MYSQL_ROOT_PASSWORD="123456" \
      --link mariadb-zabbix \
      -p 10051:10051 \
      -d zabbix/zabbix-server-mysql:latest

# filename:run-zabbix-web.sh
docker run --name zabbix-web -t \
      -e DB_SERVER_HOST="mariadb-zabbix" \
      -e MYSQL_DATABASE="zabbix" \
      -e MYSQL_USER="zabbix" \
      -e MYSQL_PASSWORD="zabbix" \
      -e MYSQL_ROOT_PASSWORD="123456" \
      --link mariadb-zabbix \
      --link zabbix-server \
      -p 8080:80 \
      -d zabbix/zabbix-web-nginx-mysql:latest

```

##### 1.3 在数据库进行数据库创建和授权。  
执行脚本后，需先在数据库里加上zabbix数据库，并进行授权，
```
create database zabbix;
CREATE USER 'zabbix'@'127.0.0.1' IDENTIFIED BY 'zabbix';
grant all privileges on zabbix.* to zabbix@localhost identified by 'zabbix';
FLUSH PRIVILEGES;
```
##### 1.4 登录web界面进行验证。  
访问http://服务器IP:8080  进行简单的zabbix初始化配置。

##### 部署过程中会遇到的问题
##### 问题一：zabbix中文乱码
从Windows机器拷贝一个simhei的字体，修改zabbix 乱码配置文件，并且把这个字体拷贝到zabbix-web容器内进行替换即可。
```
# 修改zabbix关于字体部分的配置文件
docker exec -it zabbix-web bash
vi /usr/share/zabbix/include/defines.inc.php
%s/graphfont/simhei/g
# 拷贝字体到zabbix容器内
docker cp simhei.ttf zabbix-web:/usr/share/zabbix/fonts/
```

参考了以下链接进行zabbix监控搭建  
[Zabbix-web的中文显示及其乱码问题解决方法](https://www.linuxidc.com/Linux/2017-08/146162.htm)  
[Docker 容器版的 zabbix 监控报警系统搭建](http://www.ttbrook.com/2018/03/15/docker-zabbix-email)
