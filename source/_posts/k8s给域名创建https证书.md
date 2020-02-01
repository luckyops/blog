---
title: k8s给域名创建https证书
date: 2020-02-01 16:51:14
tags:
---

在k8s集群给域名颁发https的免费证书，首先需要有一个域名，并且解析到k8s集群内，而我是使用了一个边缘节点来部署ingress，把域名解析到这个ingress节点。
k8s集群还需要安装好Helm，通过Helm来进行组件管理和部署。
在部署过程中如果出现问题，请参考官方的cert-manager架构图，结合日志来判断哪里出现了问题。

<div class="post-svg-container">
    <object type="image/svg+xml" data="high-level-overview.svg"></object>
</div>

```bash
kubectl apply --validate=false -f https://raw.githubusercontent.com/jetstack/cert-manager/v0.13.0/deploy/manifests/00-crds.yaml
kubectl create namespace cert-manager
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm install \
 --name cert-manager \
 --namespace cert-manager \
 --version v0.13.0 \
 jetstack/cert-manager
```

顺序执行以上命令，通过Helm安装cert-manager

```bash
# 查看cert-manager的pods是否正常被拉起
kubectl get pods --namespace cert-manager
```

需要配置一个Issuer， Issuer分为Issuer或者ClusterIssuer

```bash
# filename clusterissuer.yml
apiVersion: cert-manager.io/v1alpha2
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    # You must replace this email address with your own.
    # Let's Encrypt will use this to contact you about expiring
    # certificates, and issues related to your account.
    email: user@example.com
    server: https://acme-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      # Secret resource used to store the account's private key.
      name: letsencrypt-prod
    # Add a single challenge solver, HTTP01 using nginx
    solvers:
    - http01:
        ingress:
          class: nginx
```

创建这么一个文件，并且加载到k8s集群内

```bash
kubectl apply -f clusterissuer.yml
```

官方的文档ACME给的url值不对，所以如果参考官方文档，会颁发证书失败。
[cert-manager使用ACME颁发证书](https://cert-manager.io/docs/configuration/acme/)
