---
title: kubernetes常见命令
date: 2018-10-07 23:37:20
tags:
---
### 常见命令总结

#### 添加node

``` bash 
```

#### 查看node状态

``` bash
$ kubectl get nodes
NAME                 STATUS    ROLES     AGE       VERSION
docker-for-desktop   Ready     master    6d        v1.10.3

$ kubectl describe nodes docker-for-desktop
```

#### 删除node

首先，确定要排空的节点的名称。 您可以列出群集中的所有节点

``` bash
kubectl get nodes
```

禁止pod调度到该节点上

``` bash
kubectl cordon docker-for-desktop
```

驱逐该节点上的所有pod

``` bash
kubectl drain docker-for-desktop  
```


``` bash
kubectl uncordon docker-for-desktop  
```

然后告诉Kubernetes它可以重新将新pod安排到节点上。