---
title: 基于Mariabackup的备份和还原
date: 2018-12-18 15:47:06
tags:
---
#### 基于Mariabackup的备份
Mariabackup是基于Percona XtraBackup修改的一个备份工具。 Percona XtraBackup仅仅支持mariadb 10.2以前版本，关于10.3以后的mariadb就只能用mariadb修改的mariadbbackup进行备份了。  
Mariadb备份是基于物理备份的机制进行备份，和mysqldump方式有所不同，对CPU占用非常低，主要是对磁盘IO的占用比较高。
以下是备份脚本，需要建立/back/data_back、/back/full_backup、/back/tmp文件夹。
全量备份每天一次，增量备份每小时一次，备份后打包成tar文件。

``` bash
 #!/bin/bash
today=$(date +%F-%H-%M-%S)
#find /back/data_back/. -name "*.tar" -mmin +400 -exec rm {} \;
# 全量备份
rm -rf /back/full_backup/*
/usr/bin/mariabackup --defaults-file=/etc/my.cnf.d/server.cnf  --backup  --user=root --password='password' --target-dir=/back/full_backup
cd /back
tar zcf tar/full_backup-${today}.tar full_backup
```

``` bash
#!/bin/bash
today=$(date +%F-%H-%M-%S)
#find /back/data_back/. -name "leqv.sql-back-*" -mmin +400 -exec rm {} \;

# 增量备份
/usr/bin/mariabackup --backup --target-dir=/back/data_back   --incremental-basedir=/back/full_backup  --user=root --password='password'
cd /back
tar zcf tar/data_back-${today}.tar data_back
rm -rf data_back/*
```

crontab -l

``` bash
# 每天一次全量备份
0 4 * * * /bin/bash /back/tools/all_backup.sh
# 每两个小时一次增量备份
0 */2 * * * /bin/bash /back/tools/backup.sh
# sync for qingcloud
23 5 * * * qsctl cp -r  /back/tar  qs://data-backup -c '/back/tools/cred.yaml'
# clean data back
23 6 * * * find /back/tar -name "*.tar" -exec rm -f  {} \;
```

#### 基于Mariabackup的还原

因为已经在/etc/my.cnf.d/server.cnf里面定义了/data/mysql为数据存储目录，所以说要做一个软链，到/data/mysql

``` bash
ln -s /data/mysql /var/lib/mysql
```

然后开始进行增量数据和全量数据的规整

``` bash
 mariabackup --prepare --target-dir=/back/data_back  --incremental-basedir=/back/full_backup \
      --defaults-file=/etc/my.cnf.d/server.cnf --user=root --password='password'  --apply-log-only
```

还原(保证data目录为空)

``` bash
 mariabackup --copy-back --target-dir=/back/data_back  --incremental-basedir=/back/full_backup \
      --defaults-file=/etc/my.cnf.d/server.cnf --user=root --password='password'
```

修改属主属组

``` bash
 chown -R mysql:mysql /data/mysql
```

[Mariabackup Overview](https://mariadb.com/kb/en/library/mariabackup-overview/#installing-on-linux)
[mysql和mariadb备份工具xtrabackup和mariabackup（mariadb上版本必须用这个）](https://www.cnblogs.com/lei0213/p/9012272.html)
[The Backup Cycle - Full Backups](https://www.percona.com/doc/percona-xtrabackup/8.0/backup_scenarios/full_backup.html)
[MySQL · 物理备份 · Percona XtraBackup 备份原理](http://mysql.taobao.org/monthly/2016/03/07/)
[MariaDB物理备份工具Mariabackup](https://blog.csdn.net/L835311324/article/details/83627324)