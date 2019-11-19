---
title: 基于GlustFS的CetnOS持久化存储
date: 2019-01-20 14:57:14
tags:
---
### 基于centos初始化
手动修改host文件，添加节点信息。
```bash
192.168.56.2  master
192.168.56.3  slave0
192.168.56.4  slave1
192.168.56.5  slave2
```
执行初始化脚本进行初始化。

### 格式化磁盘

添加一块新的硬盘，名为/dev/sdb

```bash
fdisk /dev/sdb
mkfs.xfs -i size=512 /dev/sdb1
mkdir -p /bricks/brick1
vim /etc/fstab
#/dev/sdb1 /bricks/brick1 xfs defaults 1 2
mount -a && mount
df -h
```

### GlustFS安装和初始化

每个节点都执行以下操作

```bash
yum -y install epel-release
yum -y install yum-priorities
yum -y install centos-release-gluster
yum -y install glusterfs-server
systemctl enable glusterd.service
systemctl start glusterd.service
```

以下是初始化步骤
在master上执行

```bash
gluster peer probe slave1 #添加名为slave1的节点加入集群
gluster peer status #查看节点状态
gluster volume create k8s-volume replica 3 transport tcp slave0:/bricks/brick1 slave1:/bricks/brick1 slave2:/bricks/brick1 force #热创建一个名为k8s-volume的三备份的卷
gluster volume start k8s-volume #启动gluster卷
gluster volume stop k8s-volume #启动gluster卷
gluster volume delete k8s-volume #启动gluster卷
gluster volume info #查看gluster这个卷的更多信息
gluster volume info all


gluster volume heal k8s-volume info #检查节点同步是否健康，健康后可以挂载
sudo mount -t glusterfs master:/k8s-volume /data #进行磁盘挂载
mount.glusterfs slave0:/bricks/brick1 /data #进行磁盘挂载


vim /etc/fstab # 添加fstab
master:/k8s-volume /data   glusterfs defaults,_netdev 0 0
```

在分机执行的命令

```bash
gluster volume  add-brick   k8s-volume  master:/bricks/brick1  # 在分机上新增到主集群
gluster volume info all # 查看这个挂载的所有信息
```

### GlustFS常用操作

如果需要停止volume挂载，那么就需要先停止，再删除。

```bash
gluster volume remove-brick  k8s-volume slave1:/bricks/brick1 start # 从节点移除
gluster volume remove-brick  k8s-volume slave1:/bricks/brick1 status # 查看节点移除状态
gluster volume remove-brick  k8s-volume slave1:/bricks/brick1 commit # 进行commmit提交生效

gluster peer detach slave1  # 从集群删除节点
```

参考链接:
[GlusterFS Documentation](https://docs.gluster.org/en/v3/)
[Mount a GlusterFS volume](https://www.jamescoyle.net/how-to/439-mount-a-glusterfs-volume)
[Red Hat Storage Volumes](https://access.redhat.com/documentation/en-US/Red_Hat_Storage/2.1/html/Administration_Guide/chap-User_Guide-Setting_Volumes.html)
[GlusterFS 隐藏参数说明](http://blog.51cto.com/dangzhiqiang/1595196)