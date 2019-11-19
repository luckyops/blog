---
title: 青云对象存储挂载到Linux主机
date: 2018-09-30 13:32:40
tags:
---

因为要挂载对象存储到服务器上，经过一番挑选后，选择了国内的青云。青云支持的对象存储有SDK和通过工具直接挂载到Linux服务器上。在此只把挂载到Linux主机上做一个记录，以便日后查找使用。
挂载对象存储需要先在青云上申请，通过后会给一个qy_access_key_id以及qy_secret_access_key，在控制台创建对象存储空间，本次是lq-test名字的空间，以及需要安装qsfs这个青云开发的挂载工具。
[青云官方文档地址](https://docs.qingcloud.com/qingstor/developer_tools/qsfs.html)
服务器为CentOS7.5系统，内核4.17

### 一、开始安装软件和依赖

1、首先安装依赖库。

``` bash
 sudo yum install fuse fuse-devel libcurl-devel openssl-devel
```

2、安装完毕依赖包以后，安装qsfs本体。

``` bash
yum install -y https://pek3a.qingstor.com/releases-qs/qsfs/qsfs-latest.el7_2.x86_64.rpm
```

### 二、开始配置qsfs挂载

1、创建挂载点和挂载秘钥文件

``` bash
mkdir -p /path/to/mountpoint
touch /path/to/cred
```

2、配置访问秘钥

使用 qsfs，需要有一个配置文件来设置你的访问密钥 (注意需要设置密钥文件的权限为 600)

``` bash
echo YourAccessKeyId:YourSecretKey > /path/to/cred
chmod 600 /path/to/cred
```

3、挂载 Bucket 到本地目录

``` bash
qsfs lq-test /path/to/mountpoint -z=pek3a -c=/path/to/cred
```

4、挂载后进行验证

``` bash
$ df -T | grep qsfs
qsfs           fuse.qsfs 1099511627776       4 1099511627772   1% /path/to/mountpoint
```

5、调试步骤
如果出现问题，挂载命令加上 -d -f -U 参数查看更多日志信息

```bash
qsfs lq-test /path/to/mountpoint -z=pek3a -c=/path/to/cred -d -f -U
```

### 三、开机自动挂载

编辑/etc/fstab文件，填写以下信息保存，进行开机自动挂载

    /usr/local/bin/qsfs#lq-test /path/to/mountpoint fuse _netdev,-z=pek3a,-c=/path/to/cred,allow_other 0 0
