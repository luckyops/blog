---
title: Helm部署和配置
date: 2019-02-10 13:22:09
tags:
---
### Helm部署和配置

Helm是一个kubernetes的包管理工具，类似于centos的yum，ubuntu的apt这么个工具。
部署过程中还是很简单的，但是用起来并不是那么简单，原因有以下几点。

一、部署后需要加入集群的rbac授权。

二、需要每个节点都导入tiller镜像，由于众所周知的原因，国内拉取这个镜像会失败，需要手动拽一个需要的tiller版本镜像并且导入到minion节点。

三、部署完毕后，需要做一下存储的资源挂载到k8s集群上。

以下说一下helm的部署过程。

```bash
cd /tmp
curl https://raw.githubusercontent.com/kubernetes/helm/master/scripts/get > install-helm.sh
chmod u+x install-helm.sh
./install-helm.sh
```

执行这些，会自动进行拉取，但是因为域名的原因，我们在国内是拉取不到的，需要我们手动进行拉取。
需要我们去 https://github.com/helm/helm/releases 这里拉取自己需要的版本。

```bash
wget https://storage.googleapis.com/kubernetes-helm/helm-v2.12.3-linux-amd64.tar.gz
tar xvf helm-v2.12.3-linux-amd64.tar.gz
mv linux-amd64/helm /usr/bin/.
mv linux-amd64/tiller /usr/bin/.
```

以上是helm可执行文件的准备工作，下面进行rbac的授权。

```bash
cat << "EOF" > rbac-config.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: tiller
  namespace: kube-system
---
apiVersion: rbac.authorization.k8s.io/v1beta1
kind: ClusterRoleBinding
metadata:
  name: tiller
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: ServiceAccount
    name: tiller
    namespace: kube-system
EOF
# 加载rbac文件
kubectl create -f rbac-config.yaml
# 初始化helm
helm init --service-account tiller
# 添加helm的国内源
helm repo add stable https://charts.ost.ai
# 进行helm的repo升级
helm init --upgrade --service-account tiller
# patching helm
kubectl -n kube-system patch deployment tiller-deploy -p '{"spec": {"template": {"spec": {"automountServiceAccountToken": true}}}}'
# 进行helm的状态验证
helm ls
```

以上就是helm的部署过程，helm需要部署在kubernetes的主节点，以便和api服务器进行通信。

参考文档:

[How To Install Software on Kubernetes Clusters with the Helm Package Manager](https://www.digitalocean.com/community/tutorials/how-to-install-software-on-kubernetes-clusters-with-the-helm-package-manager)
[Helm Quickstart Guide](https://docs.helm.sh/using_helm/)
[Configuring and initializing Helm Tiller](https://docs.gitlab.com/ee/install/kubernetes/preparation/tiller.html)
[HELM-STABLE-CHARTS-MIRROR](http://charts.ost.ai/)
[Installing the Helm CLI (helm)](https://www.ibm.com/support/knowledgecenter/en/SSBS6K_3.1.1/app_center/create_helm_cli.html)