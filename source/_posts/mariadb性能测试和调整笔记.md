---
title: mariadb性能测试和调整笔记
date: 2018-12-18 12:22:26
tags:
---
基于mariadb 10.3做了一套主从同步的集群，默认开启的GTID同步，为了做性能优化和测试，参考了一些网上的文档和资料，使用了一些工具进行测试（主要是percona系列）。
我先把性能测试和优化这一部分写完，紧接着再写关于备份部分的文档。

##### mariadb调优部分

一、系统内核调优。
1、执行初始化脚本进行内核调优。
2、或者手动调整。
推荐使用xfs格式，会有更好的性能表现，于是我创建了xfs格式的lvm，方便于扩展磁盘。

``` bash
# Set the swappiness value as root
echo 1 > /proc/sys/vm/swappiness
# Alternatively, using sysctl
sysctl -w vm.swappiness=1
# Verify the change
cat /proc/sys/vm/swappiness
1
# Alternatively, using sysctl
sysctl vm.swappiness
vm.swappiness = 1
```

二、数据库配置文件优化
在my.cnf添加以下部分

``` bash
innodb_file_per_table=ON
innodb_stats_on_metadata = OFF
innodb_buffer_pool_instances = 8 # (or 1 if innodb_buffer_pool_size < 1GB)
query_cache_type = 0
query_cache_size = 0 # (disabling mutex)

innodb_buffer_pool_size = 6000M # (adjust value here, 50%-70% of total RAM)
innodb_log_file_size = 256M
innodb_flush_log_at_trx_commit = 1 # may change to 2 or 0
innodb_flush_method = O_DIRECT #mariadb default is O_DIRECT
```

加上以上参数，mariadb 10.3会有大幅度的性能提升。

mariadb0 写入服务器my.cnf样例

``` bash
#
# These groups are read by MariaDB server.
# Use it for options that only the server (but not clients) should see
#
# See the examples of server my.cnf files in /usr/share/mysql/
#

# this is read by the standalone daemon and embedded servers
[server]

# this is only for the mysqld standalone daemon
[mysqld]
datadir= /data/mysql

# 服务器id
server-id = 1
# 二进制日志文件格式
binlog-format=ROW
# ROW格式下日志的级别
binlog-row-image=minimal
# 此两项为打开从服务器崩溃二进制日志功能，信息记录在事物表而不是保存在文件
master-info-repository=TABLE
relay-log-info-repository=TABLE
# 二进制日志，后面指定存放位置。如果只是指定名字，默认存放在/var/lib/mysql下
sync_binlog = 1
expire_logs_days = 1
log-bin = /logs/mysql/mariadb-bin

slow_query_log = 1
long_query_time = 0.8
slow-query-log-file = /data/logs//mysql_slow.log

innodb_file_per_table=ON
innodb_stats_on_metadata = OFF
innodb_buffer_pool_instances = 8 # (or 1 if innodb_buffer_pool_size < 1GB)
query_cache_type = 0
query_cache_size = 0 # (disabling mutex)

innodb_buffer_pool_size = 6000M # (adjust value here, 50%-70% of total RAM)
innodb_log_file_size = 1000M
innodb_flush_log_at_trx_commit = 1 # may change to 2 or 0
innodb_flush_method = O_DIRECT #mariadb default is O_DIRECT
#
# * Galera-related settings
#
[galera]
# Mandatory settings
#wsrep_on=ON
#wsrep_provider=
#wsrep_cluster_address=
#binlog_format=row
#default_storage_engine=InnoDB
#innodb_autoinc_lock_mode=2
#
# Allow server to accept connections on all interfaces.
#
#bind-address=0.0.0.0
#
# Optional setting
#wsrep_slave_threads=1
#innodb_flush_log_at_trx_commit=0

# this is only for embedded server
[embedded]

# This group is only read by MariaDB servers, not by MySQL.
# If you use the same .cnf file for MySQL and MariaDB,
# you can put MariaDB-only options here
[mariadb]

# This group is only read by MariaDB-10.3 servers.
# If you use the same .cnf file for MariaDB of different versions,
# use this group for options that older servers don't understand
[mariadb-10.3]
```

mariadb1 读取服务器my.cnf样例

``` bash

# These groups are read by MariaDB server.
# Use it for options that only the server (but not clients) should see
#
# See the examples of server my.cnf files in /usr/share/mysql/
#

# this is read by the standalone daemon and embedded servers
[server]

# this is only for the mysqld standalone daemon
[mysqld]
datadir= /data/mysql
skip-log-bin
expire_logs_days=1
# 服务器id
server-id = 2
# 此两项为打开从服务器崩溃二进制日志功能，信息记录在事物表而不是保存在文件
master-info-repository=TABLE
relay-log-info-repository=TABLE

slow_query_log = 1
long_query_time = 0.8
slow-query-log-file = /data/logs//mysql_slow.log

innodb_file_per_table=ON
innodb_stats_on_metadata = OFF
innodb_buffer_pool_instances = 8 # (or 1 if innodb_buffer_pool_size < 1GB)
query_cache_type = 0
query_cache_size = 0 # (disabling mutex)

innodb_buffer_pool_size = 6000M # (adjust value here, 50%-70% of total RAM)
innodb_log_file_size = 256M
innodb_flush_log_at_trx_commit = 1 # may change to 2 or 0
innodb_flush_method = O_DIRECT #mariadb default is O_DIRECT

# * Galera-related settings
#
[galera]
# Mandatory settings
#wsrep_on=ON
#wsrep_provider=
#wsrep_cluster_address=
#binlog_format=row
#default_storage_engine=InnoDB
#innodb_autoinc_lock_mode=2
#
# Allow server to accept connections on all interfaces.
#
#bind-address=0.0.0.0
#
# Optional setting
#wsrep_slave_threads=1
#innodb_flush_log_at_trx_commit=0

# this is only for embedded server
[embedded]

# This group is only read by MariaDB servers, not by MySQL.
# If you use the same .cnf file for MySQL and MariaDB,
# you can put MariaDB-only options here
[mariadb]

# This group is only read by MariaDB-10.3 servers.
# If you use the same .cnf file for MariaDB of different versions,
# use this group for options that older servers don't understand
[mariadb-10.3]

```

三、基于MySQLTuner-perl进行优化和分析

``` bash
perl mysqltuner.pl --host IP --user user --pass password --forcemem 8192 #机器内存

```

[MySQLTuner-perl](https://github.com/major/MySQLTuner-perl)

[Linux OS Tuning for MySQL Database Performance](https://www.percona.com/blog/2018/07/03/linux-os-tuning-for-mysql-database-performance/)
[MariaDB基于GTID的主从复制](https://www.jianshu.com/p/26c2c03b5d67)

##### mariadb性能测试部分

mariadb的性能测试，是基于sysbench的sysbench-tpcc，需要先安装以后才能测试QPS。
sysbench有直接提供Centos的安装方式。

``` bash
curl -s https://packagecloud.io/install/repositories/akopytov/sysbench/script.rpm.sh | sudo bash
sudo yum -y install sysbench
```

安装sysbench完毕后，开始安装sysbench-tpcc

``` bash
git clone https://github.com/Percona-Lab/sysbench-tpcc.git
```

登录数据库，创建一个名字叫做sbt的库，开始测试。

``` bash
create database sbt;
```

prepare data and tables

``` bash
./tpcc.lua --mysql-socket=/tmp/mysql.sock --mysql-user=root --mysql-db=sbt --time=300 --threads=64 --report-interval=1 --tables=10 --scale=100 --db-driver=mysql prepare
```

prepare for RocksDB

``` bash
./tpcc.lua --mysql-socket=/tmp/mysql.sock --mysql-user=root  --mysql-password="password" --mysql-db=sbr --time=3000 --threads=64 --report-interval=1 --tables=10 --scale=100 --use_fk=0 --mysql_storage_engine=rocksdb --mysql_table_options='COLLATE latin1_bin' --trx_level=RC --db-driver=mysql prepare
```

Run benchmark

``` bash
./tpcc.lua --mysql-socket=/tmp/mysql.sock --mysql-user=root  --mysql-password="password" --mysql-db=sbt --time=300 --threads=64 --report-interval=1 --tables=10 --scale=100 --db-driver=mysql run
```

Cleanup

``` bash
./tpcc.lua --mysql-socket=/tmp/mysql.sock --mysql-user=root  --mysql-password="password" --mysql-db=sbt --time=300 --threads=64 --report-interval=1 --tables=10 --scale=100 --db-driver=mysql cleanup
```

会在跑分完毕后，显示数据库的QPS，Good luck!

[sysbench](https://github.com/akopytov/sysbench)
[sysbench-tpcc](https://github.com/Percona-Lab/sysbench-tpcc)
