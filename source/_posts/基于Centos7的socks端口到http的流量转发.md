---
title: 基于Centos7的socks端口到http的流量转发
date: 2018-10-03 00:36:05
tags:
---
#### 基于docker部署 ss-server 

``` bash 
docker run -dt --name ssserver -p 6443:6443 -p 6500:6500/udp mritd/shadowsocks -m "ss-server" -s "-s 0.0.0.0 -p 6443  -m chacha20 -k 密码 --fast-open" -x -e "kcpserver" -k "-t 127.0.0.1:6443 -l :6500 -mode fast2"
```

#### 基于docker部署 ss-client

``` bash
docker run --name ss-client -dt \
-p 1080:1080 \
   -e SERVER="服务器ip" \
   -e SERVER_PORT="6443" \
   -e PASSWORD="密码" \
   -e METHOD="chacha20" \
   littleqz/shadowsocks-client
```

测试

``` bash
curl --socks5 127.0.0.1:1080 http://httpbin.org/ip
```

如果返回你的 ss 服务器 ip 则测试成功.


### 安装Privoxy进行流量转发

直接进行yum安装

``` bash
yum install -y Privoxy
```

修改配置文件

``` bash
vim /etc/privoxy/config
```

找到以下两句，确保没有注释掉

``` bash 
listen-address 127.0.0.1:8118   # 8118 是默认端口，不用改，下面会用到
forward-socks5t / 127.0.0.1:1080 . # 这里的端口写 shadowsocks 的本地端口（注意最后那个 . 不要漏了）
```

启动

``` bash 
systemctl start privoxy
systemctl status privoxy
systemctl enable privoxy
```

配置 /etc/profile

``` bash
vi /etc/profile
```

添加下面两句：

``` bash
export http_proxy=http://127.0.0.1:8118       #这里的端口和上面 privoxy 中的保持一致
export https_proxy=http://127.0.0.1:8118
```

加载配置生效

``` bash 
source /etc/profile
```

测试是否生效

``` bash 
curl www.google.com
```

参考链接：

[CentOS 7 安装 shadowsocks 客户端](https://brickyang.github.io/2017/01/14/CentOS-7-%E5%AE%89%E8%A3%85-Shadowsocks-%E5%AE%A2%E6%88%B7%E7%AB%AF/)
[Mac上使用Privoxy 将 socks5转换为 http 代理](https://javasgl.github.io/transfer_socks5_to_http_proxy/)
[Convert Shadowsocks into an HTTP proxy](https://github.com/shadowsocks/shadowsocks/wiki/Convert-Shadowsocks-into-an-HTTP-proxy)
[littleqz/shadowsocks-client](https://hub.docker.com/r/littleqz/shadowsocks-client/)
[How to Deploy Google BBR on CentOS 7](https://www.vultr.com/docs/how-to-deploy-google-bbr-on-centos-7)