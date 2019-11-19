---
title: openresty配置request&respone输出到log
date: 2019-06-18 28:03:52
tags:
---
openresty配置request&respone输出到log
本机已安装openresty，并且配置正常访问。  
需要openresty加载lua，然后把request和respone输出到日志里。  
参考如下:  
```bash
# 添加以下内容进入openresty的server_name具体监听的conf里
lua_need_request_body on;

set $resp_body "";
body_filter_by_lua '
  local resp_body = string.sub(ngx.arg[1], 1, 1000)
  ngx.ctx.buffered = (ngx.ctx.buffered or "") .. resp_body
  if ngx.arg[2] then
     ngx.var.resp_body = ngx.ctx.buffered
  end
';

set $req_header "";
  set $resp_header "";
  header_filter_by_lua ' 
  local h = ngx.req.get_headers()
  for k, v in pairs(h) do
      ngx.var.req_header = ngx.var.req_header .. k.."="..v.." "
  end
  local rh = ngx.resp.get_headers()
  for k, v in pairs(rh) do
      ngx.var.resp_header = ngx.var.resp_header .. k.."="..v.." "
  end
';
```

修改openresty主文件的nginx.conf配置文件，修改log格式配置
```bash
        log_format json_combined escape=json '{"@timestamp":"$time_iso8601",'
                              '"@source":"$server_addr",'
                              '"@nginx_fields":{'
                              '"remote_addr":"$remote_addr",'
                              '"remote_user":"$remote_user",'
                              '"body_bytes_sent":"$body_bytes_sent",'
                              '"request_time":"$request_time",'
                              '"status":"$status",'
                              '"host":"$host",'
                              '"uri":"$uri",'
                              '"server":"$server_name",'
                              '"port":"$server_port",'
                              '"protocol":"$server_protocol",'
                              '"request_uri":"$request_uri",'
                              '"request_body":"$request_body",'
                              '"request_method":"$request_method",'
                              '"http_referrer":"$http_referer",'
                              '"body_bytes_sent":"$body_bytes_sent",'
                              '"http_x_forwarded_for":"$http_x_forwarded_for",'
                              '"http_user_agent":"$http_user_agent",'
                              '"upstream_response_time":"$upstream_response_time",'
                              '"upstream_addr":"$upstream_addr",'
                              '"req_header":"$req_header",'
                              '"req_body":"$request_body",'
                              '"resp_header":"$resp_header",'
                              '"resp_body":"$resp_body"}}';```

修改完成后执行测试，并且重启生效
```bash
openresty -t
openresty -s reload
```

参考链接：
[Logging request & response body and headers with nginx](https://www.hardill.me.uk/wordpress/2018/03/14/logging-requests-and-response-with-nginx/)
[Is it possible to log the response data in nginx access log?](https://serverfault.com/questions/361556/is-it-possible-to-log-the-response-data-in-nginx-access-log)
```