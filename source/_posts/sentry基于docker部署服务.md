---
title: sentry基于docker部署服务
date: 2018-11-14 16:01:37
tags:
---

####  前言

sentry搭建最简单的办法是基于docker进行部署。
Linux主机需要进行初始化配置，升级4.1*内核以及安装docker服务。

####  安装准备

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

##### 安装docker服务

``` bash 
curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun
```

##### 启动docker服务

``` bash 
systemctl enable docker
systemctl start docker
```

##### 部署sentry

参考sentry在hub.docker.com上面的教程进行的部署。

创建一个redis容器

``` bash
docker run -d --name sentry-redis redis
```

创建一个Postgres容器

``` bash
docker run -d --name sentry-postgres -e POSTGRES_PASSWORD=secret -e POSTGRES_USER=sentry postgres
```

生成新的秘钥

``` bash
docker run --rm sentry config generate-secret-key
```

复制产生的secret-key，在以下几个语句进行替换

新搭建的时候，是要把秘钥加进去执行一次upgrade

```bash
docker run -it --rm -e SENTRY_SECRET_KEY='<secret-key>' --link sentry-postgres:postgres --link sentry-redis:redis sentry upgrade
```

会提示你输入管理员账号和密码，这时候是创建管理用户。


开启sentry服务

```bash
docker run -d --name my-sentry -e SENTRY_SECRET_KEY='<secret-key>' --link sentry-redis:redis --link sentry-postgres:postgres sentry
docker run -d --name sentry-cron -e SENTRY_SECRET_KEY='<secret-key>' --link sentry-postgres:postgres --link sentry-redis:redis sentry run cron
docker run -d --name sentry-worker-1 -e SENTRY_SECRET_KEY='<secret-key>' --link sentry-postgres:postgres --link sentry-redis:redis sentry run worker
```

##### 注意事项

如果在upgrade的时候错过了创建用户的机会，可以执行以下命令创建用户

``` bash
docker run -it --rm -e SENTRY_SECRET_KEY='<secret-key>' --link sentry-redis:redis --link sentry-postgres:postgres sentry createuser
```

以上值得注意的几点，就是拉起来名字叫my-sentry的容器的时候，可以做端口暴露，于是直接通过ip加端口的方式进行访问，执行以下命令即可。

``` bash
docker run -d --name my-sentry -e SENTRY_SECRET_KEY='<secret-key>' -p 9000:9000 --link sentry-redis:redis --link sentry-postgres:postgres sentry
docker run -d --name sentry-cron -e SENTRY_SECRET_KEY='<secret-key>' --link sentry-postgres:postgres --link sentry-redis:redis sentry run cron
docker run -d --name sentry-worker-1 -e SENTRY_SECRET_KEY='<secret-key>' --link sentry-postgres:postgres --link sentry-redis:redis sentry run worker
```

如果需要配置邮箱的话，可以参考以下命令

``` bash
docker run -d --name my-sentry \
    -p 9090:9000 \
    -e SENTRY_SERVER_EMAIL=邮箱账号 \
    -e SENTRY_EMAIL_HOST=smtp.exmail.qq.com \
    -e SENTRY_EMAIL_PORT=465 \
    -e SENTRY_EMAIL_USER=邮箱账号 \
    -e SENTRY_EMAIL_PASSWORD=邮箱密码 \
    -e SENTRY_EMAIL_USE_TLS=true \
    -e SENTRY_SECRET_KEY='<secret-key>' \
    --link sentry-redis:redis \
    --link sentry-postgres:postgres sentry
docker rm -f sentry-cron
docker run -d --name sentry-cron \
    -e SENTRY_SERVER_EMAIL=邮箱账号 \
    -e SENTRY_EMAIL_HOST=smtp.exmail.qq.com \
    -e SENTRY_EMAIL_PdRT=465 \
    -e SENTRY_EMAIL_USER=邮箱账号 \
    -e SENTRY_EMAIL_PASSWORD=邮箱密码 \
    -e SENTRY_EMAIL_USE_TLS=true \
    -e SENTRY_SECRET_KEY='<secret-key>' \
    --link sentry-postgres:postgres \
    --link sentry-redis:redis sentry run cron
docker rm -f sentry-worker-1
docker run -d --name sentry-worker-1 \
    -e SENTRY_SERVER_EMAIL=邮箱账号 \
    -e SENTRY_EMAIL_HOST=smtp.exmail.qq.com \
    -e SENTRY_EMAIL_PORT=465 \
    -e SENTRY_EMAIL_USER=邮箱账号 \
    -e SENTRY_EMAIL_PASSWORD=邮箱密码 \
    -e SENTRY_EMAIL_USE_TLS=true \
    -e SENTRY_SECRET_KEY='<secret-key>' \
    --link sentry-postgres:postgres --link sentry-redis:redis sentry run worker
```

可以把这些命令保存成脚本进行保存执行，以便再次启动。

##### 升级工作

用了一段时间sentry以后，sentry出了新版本，于是需要抽空进行一次升级，在这里做一下记录。
因为是docker部署的，所以中间需要拉取最新的docker镜像，然后拉起来容器，并且执行数据库升级操作。
在网上找了不少资料，都是关于sentry部署，关于升级提到的文档是少之又少。

拉取最新版本镜像

``` bash
docker pull sentry:latest
```

正常拉起容器

```bash
docker run -d --name my-sentry \
    -p 9090:9000 \
    -e SENTRY_SERVER_EMAIL=邮箱账号 \
    -e SENTRY_EMAIL_HOST=smtp.exmail.qq.com \
    -e SENTRY_EMAIL_PORT=465 \
    -e SENTRY_EMAIL_USER=邮箱账号 \
    -e SENTRY_EMAIL_PASSWORD=邮箱密码 \
    -e SENTRY_EMAIL_USE_TLS=true \
    -e SENTRY_SECRET_KEY='<secret-key>' \
    --link sentry-redis:redis \
    --link sentry-postgres:postgres sentry
docker rm -f sentry-cron
docker run -d --name sentry-cron \
    -e SENTRY_SERVER_EMAIL=邮箱账号 \
    -e SENTRY_EMAIL_HOST=smtp.exmail.qq.com \
    -e SENTRY_EMAIL_PdRT=465 \
    -e SENTRY_EMAIL_USER=邮箱账号 \
    -e SENTRY_EMAIL_PASSWORD=邮箱密码 \
    -e SENTRY_EMAIL_USE_TLS=true \
    -e SENTRY_SECRET_KEY='<secret-key>' \
    --link sentry-postgres:postgres \
    --link sentry-redis:redis sentry run cron
docker rm -f sentry-worker-1
docker run -d --name sentry-worker-1 \
    -e SENTRY_SERVER_EMAIL=邮箱账号 \
    -e SENTRY_EMAIL_HOST=smtp.exmail.qq.com \
    -e SENTRY_EMAIL_PORT=465 \
    -e SENTRY_EMAIL_USER=邮箱账号 \
    -e SENTRY_EMAIL_PASSWORD=邮箱密码 \
    -e SENTRY_EMAIL_USE_TLS=true \
    -e SENTRY_SECRET_KEY='<secret-key>' \
    --link sentry-postgres:postgres --link sentry-redis:redis sentry run worker
```

拉起容器后，进入my-sentry容器，执行升级命令

``` bash
docker exec -it my-sentry bash
sentry upgrade
# 等待数据库升级完成，会提示有数据库的表变更，是否要删除，可以输入yes
```

以上就可以说是升级完成。

##### 修复邮箱发送邮件问题

sentry有一个发送邮件问题，使用自带的smtp发送测试邮件，提示timeout。
在网上找了一圈这个问题怎么解决，最后有一个文档说装第三方的smtp模块来解决这个问题。
以下是操作步骤

```bash
docker exec -it my-sentry bash
pip install django-smtp-ssl==1.0
exit
docker exec -it sentry-worker-1 bash
pip install django-smtp-ssl==1.0
exit
docker exec -it sentry-cron bash
pip install django-smtp-ssl==1.0
exit
```

安装完毕第三方组建后，需要在配置文件里也进行相应的修改，把配置文件拷贝出来.

```bash
docker cp sentry-worker-1:/etc/sentry/sentry.conf.py .

# 修改以下文件，把这些部分注释掉
###############
# Mail Server #
###############


#email = env('SENTRY_EMAIL_HOST') or (env('SMTP_PORT_25_TCP_ADDR') and 'smtp')
#if email:
#    SENTRY_OPTIONS['mail.backend'] = 'smtp'
#    SENTRY_OPTIONS['mail.host'] = email
#    SENTRY_OPTIONS['mail.password'] = env('SENTRY_EMAIL_PASSWORD') or ''
#    SENTRY_OPTIONS['mail.username'] = env('SENTRY_EMAIL_USER') or ''
#    SENTRY_OPTIONS['mail.port'] = int(env('SENTRY_EMAIL_PORT') or 25)
#    SENTRY_OPTIONS['mail.use-tls'] = env('SENTRY_EMAIL_USE_TLS', False)
#else:
#    SENTRY_OPTIONS['mail.backend'] = 'dummy'


SENTRY_OPTIONS['mail.backend'] = 'django_smtp_ssl.SSLEmailBackend'
SENTRY_OPTIONS['mail.host'] = 'smtp.exmail.qq.com'
SENTRY_OPTIONS['mail.password'] = '邮箱密码'
SENTRY_OPTIONS['mail.username'] = '邮箱账号'
SENTRY_OPTIONS['mail.port'] = 465
SENTRY_OPTIONS['mail.use-tls'] = False

# 修改完毕后，保存，并且进行替换
docker cp sentry.conf.py sentry-worker-1:/etc/sentry/sentry.conf.py
docker cp sentry.conf.py my-sentry:/etc/sentry/sentry.conf.py
docker cp sentry.conf.py sentry-cron:/etc/sentry/sentry.conf.py

# 重启相应容器
docker restart sentry-worker-1 my-sentry sentry-cron

```

修复步骤完成，登陆网页进行发送邮件测试。