---
title: lvm磁盘扩展创建和缩放调整步骤
date: 2018-12-18 12:16:33
tags:
---

####  lvm创建，扩展，以及缩放调整
##### lvm 创建pv，创建lv

``` bash
yum install lvm2 -y
fdisk -l
fdisk /dev/sdb
fdisk -l
vgcreate VolGroup00 /dev/sdb1
vgs
lvcreate -L 19.9G -n lv1 VolGroup00
lvdisplay
mkfs.xfs /dev/VolGroup00/lv1
# xfs在创建mysql实例时使用，会有更好的性能表现和可扩展性，默认可以使用ext4
mount /dev/VolGroup00/lv1 /data
blkid /dev/VolGroup00/lv1
vim /etc/fstab #修改fstab加载开机引导
UUID=c4f76c9b-5551-4124-a997-777e295eb9d6 /back                   xfs     defaults        0 0
/dev/VolGroup00/lv1  /data                  xfs     defaults        0 0
```

#### lvm扩展

ext4格式

``` bash
vgextend VolGroup00 /dev/sdc
vgs
lvextend -L +1G /dev/VolGroup00/lv1
resize2fs /dev/VolGroup00/lv1
```

xfs格式

``` bash
vgextend VolGroup00 /dev/sdc
vgs
lvextend -L +1G /dev/VolGroup00/lv1
xfs_growfs /dev/VolGroup00/lv1
```

机器重置后，硬盘上的lvm分区还在，挂载到本机。
Activating and Mounting the Original Logical Volume

```bash
[root@tng3-1 ~]# lvchange -a y /dev/VolGroup00/lv1

[root@tng3-1 ~]# mount /dev/VolGroup00/lv1 /mnt
[root@tng3-1 ~]# df
Filesystem           1K-blocks      Used Available Use% Mounted on
/dev/yourvg/yourlv    24507776        32  24507744   1% /mnt
/dev/VolGroup00/lv1        24507776        32  24507744   1% /mnt
```


ref:
[CentOS 6.3下配置LVM（逻辑卷管理）](http://www.cnblogs.com/mchina/p/linux-centos-logical-volume-manager-lvm.html)
[stackoverflow xfs调整lvm](https://stackoverflow.com/questions/26305376/resize2fs-bad-magic-number-in-super-block-while-trying-to-open)
[Activating and Mounting the Original Logical Volume](https://access.redhat.com/documentation/en-US/Red_Hat_Enterprise_Linux/4/html/Cluster_Logical_Volume_Manager/active_mount_ex3.html)
