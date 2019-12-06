---
title: openresty_install_vts.md
date: 2019-04-23 13:04:43
tags:
---

#### nginx moudle vts
nginx vts地址为 https://github.com/BoTranVan/nginx-module-vts.git
执行以下命令clone仓库

```bash
git clone https://github.com/BoTranVan/nginx-module-vts.git
```

#### openresty install vts插件

机器上已经有yum装好的openresty，所以需要下载openresty源码，重新build一个安装插件的版本。

下载地址：https://openresty.org/en/download.html
以openresty 1.13.6.1版本为例，执行以下命令

```bash
mkdir -p /home/server/nginx;
wget https://openresty.org/download/openresty-1.13.6.1.tar.gz | gunzip |  tar x -C /home/server/nginx
cd  /home/server/nginx/openresty-1.13.6.2;
# 执行这个命令进行测试
./configure --with-http_v2_module --with-http_ssl_module --add-module=/home/server/nginx-module-vts
# 如果执行测试没有问题，进行安装
./configure  --with-http_v2_module --with-http_ssl_module --add-module=/home/server/nginx-module-vts && make && make install
# 安装完毕需要进行测试
openresty -t
# 查看输出
$ nginx: the configuration file /usr/local/openresty/nginx/conf/nginx.conf syntax is ok
$ nginx: configuration file /usr/local/openresty/nginx/conf/nginx.conf test is successful
# 如果输出没问题，重新启动openresty
systemctl restart openresty
# 执行openresty -V进行校对
openresty -V
# 查看输出
$ nginx version: openresty/1.13.6.2
built by gcc 4.8.5 20150623 (Red Hat 4.8.5-36) (GCC)
built with OpenSSL 1.0.2k-fips  26 Jan 2017
TLS SNI support enabled
configure arguments: --prefix=/usr/local/openresty/nginx --with-cc-opt=-O2 --add-module=../ngx_devel_kit-0.3.0 --add-module=../echo-nginx-module-0.61 --add-module=../xss-nginx-module-0.06 --add-module=../ngx_coolkit-0.2rc3 --add-module=../set-misc-nginx-module-0.32 --add-module=../form-input-nginx-module-0.12 --add-module=../encrypted-session-nginx-module-0.08 --add-module=../srcache-nginx-module-0.31 --add-module=../ngx_lua-0.10.13 --add-module=../ngx_lua_upstream-0.07 --add-module=../headers-more-nginx-module-0.33 --add-module=../array-var-nginx-module-0.05 --add-module=../memc-nginx-module-0.19 --add-module=../redis2-nginx-module-0.15 --add-module=../redis-nginx-module-0.3.7 --add-module=../rds-json-nginx-module-0.15 --add-module=../rds-csv-nginx-module-0.09 --add-module=../ngx_stream_lua-0.0.5 --with-ld-opt=-Wl,-rpath,/usr/local/openresty/luajit/lib --add-module=/home/server/nginx-module-vts --with-stream --with-stream_ssl_module --with-http_ssl_module
```

编译openresty 完成，需要修改nginx.conf增加配置文件。

```bash
vim  /usr/local/openresty/nginx/conf/nginx.conf
# 在http区块增加以下配置
    vhost_traffic_status_zone;
# 在server区增加以下配置
    location /nginx_status {
        vhost_traffic_status_display;
        vhost_traffic_status_display_format html;
        allow 127.0.0.1;
        allow 172.17.0.0/24;
    }
    location ~ \.php|^/php_status$ {
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_index index.php;
        fastcgi_connect_timeout 180;
        fastcgi_read_timeout 600;
        fastcgi_send_timeout 600;
        include fastcgi.conf;
        allow 127.0.0.1;
        allow 172.17.0.0/24;
    }
# 执行 openresty -t进行测试，如果没有问题，openresty -s reload重启生效
```



#### nginx install vts插件

机器上已经有yum装好的nginx，所以需要下载nginx源码，重新build一个安装插件的版本。

下载地址：http://nginx.org/en/download.html
以nginx 1.15.10版本为例，执行以下命令

```bash
mkdir -p /home/server/nginx;
curl -Lk http://nginx.org/download/nginx-1.15.10.tar.gz  | gunzip |  tar x -C /home/server/nginx
cd /home/server/nginx/nginx-1.15.10;
#先手动查看一下nginx的编译参数
nginx -V
$ nginx version: nginx/1.15.10
built by gcc 4.8.5 20150623 (Red Hat 4.8.5-36) (GCC)
built with OpenSSL 1.0.2k-fips  26 Jan 2017
TLS SNI support enabled
configure arguments: --prefix=/etc/nginx --sbin-path=/usr/sbin/nginx --modules-path=/usr/lib64/nginx/modules --conf-path=/etc/nginx/nginx.conf --error-log-path=/var/log/nginx/error.log --http-log-path=/var/log/nginx/access.log --pid-path=/var/run/nginx.pid --lock-path=/var/run/nginx.lock --http-client-body-temp-path=/var/cache/nginx/client_temp --http-proxy-temp-path=/var/cache/nginx/proxy_temp --http-fastcgi-temp-path=/var/cache/nginx/fastcgi_temp --http-uwsgi-temp-path=/var/cache/nginx/uwsgi_temp --http-scgi-temp-path=/var/cache/nginx/scgi_temp --user=nginx --group=nginx --with-compat --with-file-aio --with-threads --with-http_addition_module --with-http_auth_request_module --with-http_dav_module --with-http_flv_module --with-http_gunzip_module --with-http_gzip_static_module --with-http_mp4_module --with-http_random_index_module --with-http_realip_module --with-http_secure_link_module --with-http_slice_module --with-http_ssl_module --with-http_stub_status_module --with-http_sub_module --with-http_v2_module --with-mail --with-mail_ssl_module --with-stream --with-stream_realip_module --with-stream_ssl_module --with-stream_ssl_preread_module --with-cc-opt='-O2 -g -pipe -Wall -Wp,-D_FORTIFY_SOURCE=2 -fexceptions -fstack-protector-strong --param=ssp-buffer-size=4 -grecord-gcc-switches -m64 -mtune=generic -fPIC' --with-ld-opt='-Wl,-z,relro -Wl,-z,now -pie'
# 执行这个命令进行测试，把要安装的插件加在后面 --add-module=/home/server/nginx-module-vts
./configure  --prefix=/etc/nginx --sbin-path=/usr/sbin/nginx --modules-path=/usr/lib64/nginx/modules --conf-path=/etc/nginx/nginx.conf --error-log-path=/var/log/nginx/error.log --http-log-path=/var/log/nginx/access.log --pid-path=/var/run/nginx.pid --lock-path=/var/run/nginx.lock --http-client-body-temp-path=/var/cache/nginx/client_temp --http-proxy-temp-path=/var/cache/nginx/proxy_temp --http-fastcgi-temp-path=/var/cache/nginx/fastcgi_temp --http-uwsgi-temp-path=/var/cache/nginx/uwsgi_temp --http-scgi-temp-path=/var/cache/nginx/scgi_temp --user=nginx --group=nginx --with-compat --with-file-aio --with-threads --with-http_addition_module --with-http_auth_request_module --with-http_dav_module --with-http_flv_module --with-http_gunzip_module --with-http_gzip_static_module --with-http_mp4_module --with-http_random_index_module --with-http_realip_module --with-http_secure_link_module --with-http_slice_module --with-http_ssl_module --with-http_stub_status_module --with-http_sub_module --with-http_v2_module --with-mail --with-mail_ssl_module --with-stream --with-stream_realip_module --with-stream_ssl_module --with-stream_ssl_preread_module --with-cc-opt='-O2 -g -pipe -Wall -Wp,-D_FORTIFY_SOURCE=2 -fexceptions -fstack-protector-strong --param=ssp-buffer-size=4 -grecord-gcc-switches -m64 -mtune=generic -fPIC' --with-ld-opt='-Wl,-z,relro -Wl,-z,now -pie'  --add-module=/home/server/nginx-module-vts
# 如果执行测试没有问题，进行安装
./configure  --prefix=/etc/nginx --sbin-path=/usr/sbin/nginx --modules-path=/usr/lib64/nginx/modules --conf-path=/etc/nginx/nginx.conf --error-log-path=/var/log/nginx/error.log --http-log-path=/var/log/nginx/access.log --pid-path=/var/run/nginx.pid --lock-path=/var/run/nginx.lock --http-client-body-temp-path=/var/cache/nginx/client_temp --http-proxy-temp-path=/var/cache/nginx/proxy_temp --http-fastcgi-temp-path=/var/cache/nginx/fastcgi_temp --http-uwsgi-temp-path=/var/cache/nginx/uwsgi_temp --http-scgi-temp-path=/var/cache/nginx/scgi_temp --user=nginx --group=nginx --with-compat --with-file-aio --with-threads --with-http_addition_module --with-http_auth_request_module --with-http_dav_module --with-http_flv_module --with-http_gunzip_module --with-http_gzip_static_module --with-http_mp4_module --with-http_random_index_module --with-http_realip_module --with-http_secure_link_module --with-http_slice_module --with-http_ssl_module --with-http_stub_status_module --with-http_sub_module --with-http_v2_module --with-mail --with-mail_ssl_module --with-stream --with-stream_realip_module --with-stream_ssl_module --with-stream_ssl_preread_module --with-cc-opt='-O2 -g -pipe -Wall -Wp,-D_FORTIFY_SOURCE=2 -fexceptions -fstack-protector-strong --param=ssp-buffer-size=4 -grecord-gcc-switches -m64 -mtune=generic -fPIC' --with-ld-opt='-Wl,-z,relro -Wl,-z,now -pie'  --add-module=/home/server/nginx-module-vts && make && make install
# 安装完毕需要进行测试
nginx -t
# 查看输出
$ nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
$ nginx: configuration file /etc/nginx/nginx.conf test is successful
# 如果输出没问题，重新启动nginx
systemctl restart nginx
# 执行nginx-V进行校对
nginx -V
# 查看输出
nginx version: nginx/1.15.10
built by gcc 4.8.5 20150623 (Red Hat 4.8.5-36) (GCC)
built with OpenSSL 1.0.2k-fips  26 Jan 2017
TLS SNI support enabled
configure arguments: --prefix=/etc/nginx --sbin-path=/usr/sbin/nginx --modules-path=/usr/lib64/nginx/modules --conf-path=/etc/nginx/nginx.conf --error-log-path=/var/log/nginx/error.log --http-log-path=/var/log/nginx/access.log --pid-path=/var/run/nginx.pid --lock-path=/var/run/nginx.lock --http-client-body-temp-path=/var/cache/nginx/client_temp --http-proxy-temp-path=/var/cache/nginx/proxy_temp --http-fastcgi-temp-path=/var/cache/nginx/fastcgi_temp --http-uwsgi-temp-path=/var/cache/nginx/uwsgi_temp --http-scgi-temp-path=/var/cache/nginx/scgi_temp --user=nginx --group=nginx --with-compat --with-file-aio --with-threads --with-http_addition_module --with-http_auth_request_module --with-http_dav_module --with-http_flv_module --with-http_gunzip_module --with-http_gzip_static_module --with-http_mp4_module --with-http_random_index_module --with-http_realip_module --with-http_secure_link_module --with-http_slice_module --with-http_ssl_module --with-http_stub_status_module --with-http_sub_module --with-http_v2_module --with-mail --with-mail_ssl_module --with-stream --with-stream_realip_module --with-stream_ssl_module --with-stream_ssl_preread_module --with-cc-opt='-O2 -g -pipe -Wall -Wp,-D_FORTIFY_SOURCE=2 -fexceptions -fstack-protector-strong --param=ssp-buffer-size=4 -grecord-gcc-switches -m64 -mtune=generic -fPIC' --with-ld-opt='-Wl,-z,relro -Wl,-z,now -pie' --add-module=/home/server/nginx-module-vts

编译nginx 完成，需要修改nginx.conf增加配置文件。

```bash
vim /etc/nginx/nginx.conf
# 在http区块增加以下配置
    vhost_traffic_status_zone;
# 在server区增加以下配置
    location /nginx_status {
        vhost_traffic_status_display;
        vhost_traffic_status_display_format html;
        allow 127.0.0.1; # 允许本地访问
        allow 172.17.0.0/24; # 允许docker容器访问
    }
    location ~ \.php|^/php_status$ {
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_index index.php;
        fastcgi_connect_timeout 180;
        fastcgi_read_timeout 600;
        fastcgi_send_timeout 600;
        include fastcgi.conf;
        allow 127.0.0.1; # 允许本地访问
        allow 172.17.0.0/24; # 允许docker容器访问
    }
# 执行 nginx -t进行测试，如果没有问题，nginx -s reload重启生效
```

#### 部署ngninx-vts-exporter

关于编译了vts插件以后，nginx和openresty的信息就不能用默认的信息采集客户端来做了，比如说prometheus用的nginx-exporter，就得用vts版。
在这里提供两个简单的nginx vts/openresty vts的exporter。
```$xslt
# nginx-exporter
docker rm -f nginx-exporter ; docker run  -d --restart always --name nginx-exporter   -p 9913:9913  --env NGINX_STATUS="http://172.17.0.1:8080/nginx_status/format/json" sophos/nginx-vts-exporter
```
nginx/openresty配置文件
```$xslt
server {
    listen 8080;
    server_name _;
    index    index.php    index.html    index.htm;

    ssl_ciphers         AES:ALL:!ADH:!EXP:!LOW:!RC2:!3DES:!SEED:!aNULL:!eNULL:-RC4:RC4-SHA:+HIGH:+MEDIUM;
    ssl_protocols       SSLv3 TLSv1 TLSv1.1 TLSv1.2;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    proxy_set_header   Host             $host;
    proxy_set_header   X-Real-IP        $remote_addr;
    proxy_set_header   X-Forwarded-For  $proxy_add_x_forwarded_for;

    location ~ \.(js|css|png|jpg|jpeg|gif|mp3|mp4|svga|ipa|plist|apk)$ {
       expires off;
        if (!-e $request_filename) {
            break;
        }
     }
    location /nginx_status {
        vhost_traffic_status_display;
        vhost_traffic_status_display_format html;
        allow 127.0.0.1;
        allow 172.17.0.0/24;
    }
    location ~ \.php|^/php_status$ {
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_index index.php;
        fastcgi_connect_timeout 180;
        fastcgi_read_timeout 600;
        fastcgi_send_timeout 600;
        include fastcgi.conf;
        allow 127.0.0.1;
        allow 172.17.0.0/24;
    }
}
```

我个人来讲，推荐使用ansible的playbook来做这个事情，或者在使用了k8s以后，把这个编排到相应的helm包里，这样会好很多。
这种手动实现的方式实际上是最初级最丑陋的，我们做技术的人还是要对技术有一定追求的嘛，虽然身在小厂可能平时用不到，但是也需要了解。