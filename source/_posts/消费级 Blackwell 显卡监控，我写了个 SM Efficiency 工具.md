---
title: 消费级 Blackwell 显卡监控，我写了个 SM Efficiency 工具
date: 2026-06-23 19:19:33
tags:
---

前一阵子在 RTX 5090 上跑 vLLM，`nvidia-smi` 里的 GPU-Util 基本一直是 90% 以上。按常见的理解，这张卡已经快跑满了。

但是我用 Nsight 看硬件计数器后，发现不是这么回事：同一段 LLM 解码负载，GPU-Util 中位数是 94%，SM Throughput 却只有 5.0%，显存带宽用到了 67.6%。

这个反差有点大，也是我写 [sm-efficiency](https://github.com/luckyops/sm-efficiency) 这个工具的原因。

#### GPU-Util 94% 不代表算力用了 94%

`nvidia-smi` 里的 GPU-Util 来自 NVML。[NVIDIA 对它的定义](https://docs.nvidia.com/deploy/nvml-api/structnvmlUtilization__t.html)是：在过去的采样周期内，有一个或多个 kernel 正在 GPU 上执行的时间占比。

它回答的是“GPU 有多少时间不空闲”，不是“GPU 的计算单元吃满了多少”。

LLM 解码阶段每次只生成一个 token，kernel 一个接一个，所以 GPU-Util 可以长时间保持在 90% 以上。但每个 token 都要把大量模型权重从显存搬到 SM，计算单元很多时间其实在等数据。

也就是说，kernel 几乎全程在场，但不是计算管线几乎全程满载。

| 指标 | 实测值 | 它实际表示什么 |
|---|---:|---|
| GPU-Util | 94% | 采样周期内有 kernel 运行的时间占比 |
| SM Throughput | 5.0% | SM 子单元中最忙者距持续峰值的百分比 |
| Tensor 管道活跃率 | 5.0% | Tensor 计算管道距持续峰值的百分比 |
| 显存带宽 | 67.6% | 显存总带宽的硬件计数器吞吐 |
| Occupancy | 11.1% | 每个 SM 上驻留 warp 的比例 |

这里还要说一个容易误解的地方。`SM Throughput [Throughput %]` 是 NVIDIA 定义的顶层吞吐指标，取 SM 各组成计数器中最高的一项，再和 peak sustained rate 比较。它是很有价值的硬件吞吐视角，但不等于“实际 FLOP/s 除以理论峰值 FLOP/s”。项目名仍然沿用了容易理解的 SM Efficiency，指标语义以 SM Throughput 为准。

{% asset_img gpu-util-vs-sm-efficiency.svg GPU-Util 与 SM Throughput 对比 %}

#### 消费级 Blackwell 上好像没这种工具

知道 GPU-Util 不够用以后，下一步就是找一个能持续查看硬件计数器的方案。但在 GeForce 上，常见的几条路都有问题。

- DCGM 虽然支持 GeForce 的部分基础功能，但[profiling 硬件计数器目前只支持 Volta 开始的数据中心产品](https://docs.nvidia.com/datacenter/dcgm/latest/learn/modules/profiling.html)。
- `nvidia-smi` 和普通 NVML 可以拿到利用率、显存、功耗、温度和时钟，但没有我要的 SM Throughput、Tensor 管道和 Occupancy。
- Nsight Compute 更适合做 kernel 级的深度分析。它的普通 Profile Activity 不能直接挂到一个任意的已运行服务上，CLI 的 attach 对象也需要事先由 ncu 以 launch 模式启动。而且硬件计数器采集可能需要 kernel replay，用它来观察线上推理服务，很容易改变原本想测的行为。

最后能走通的是 Nsight Systems 的 GPU Metrics。它可以以固定频率读取 device-level 硬件计数器，而且不需要 attach 或注入已运行的 vLLM 进程。NVIDIA 对这个模式的定位也是单次采样、minimal overhead。

它的限制同样很明确：[GPU Metrics 看到的是整张卡，不知道数据属于哪个进程或 CUDA context](https://docs.nvidia.com/nsight-systems/UserGuide/index.html#gpu-metrics)。所以做性能分析时，最好让目标服务独占被测 GPU。

#### 工具是怎么做的

整个项目没有引入新的常驻服务，主要是 Bash 加 Python 标准库，把 nsys 批处理工具包成了一套可以日常使用的监控。

数据流程如下：

```text
nsys 以 50Hz 采样 gb20x-top 硬件计数器
        ↓
导出 .nsys-rep 和 SQLite
        ↓
sm_parse.py 按指标名解析 GPU_METRICS
        ↓
sm_status.json
        ↓
gpu_watch.sh 合并 nvidia-smi 与 vLLM/llama.cpp metrics
```

项目里有三个主要工具：

```bash
./sm_efficiency.sh 30     # 一次性精确测量，保留 nsys 报告和 SQLite
./sm_daemon.sh start      # 常驻低开销采样
./gpu_watch.sh            # 打开实时终端面板
```

`sm_efficiency.sh` 适合做一次性分析，会保留完整报告供 nsys-ui 查看。`sm_daemon.sh` 则只开 GPU Metrics，使用 `--trace=none`，不做 CUDA API trace，这个模式适合长时间运行。

守护模式每轮得到的不只是 SM Throughput，还会同时拿到 Tensor 管道、VRAM 带宽、Occupancy 和 GR Engine Active。面板再把这些数据和 `nvidia-smi`、vLLM 或 llama.cpp 的 Prometheus 指标放到一起，就可以同时看到 token 吞吐、TPOT、并发、排队、KV cache、功耗和真正的硬件吞吐。

{% asset_img dashboard.svg sm-efficiency 实时监控面板 %}

#### 要注意的细节

第一：metric ID 不可信。

nsys 导出的 `GPU_METRICS` 表里是数字 ID，但 ID 会随 nsys 版本和指标集变化。如果把 RTX 5090 + `gb20x-top` 上实测的 ID 直接写死，换个环境后最危险的不是报错，而是静默地把别的指标当成 SM Throughput。

现在的解析逻辑优先读 `TARGET_INFO_GPU_METRICS` 名称表，必须完整匹配 `SM Throughput [Throughput %]` 这类带单位的名称。名称表存在但匹配不到时，直接输出 N/A，不会回退到旧 ID。只有名称表整体缺失时，才会使用已验证的回退 ID，并且显式警告。监控软件宁可没数，也不能给错数。

第二：nsys 不是流式监控工具。

每次采样都要启动会话、收尾并导出报告，单 worker 最开始大约 8 秒才能产生一个新数据点。我本来想并发跑多个会话，但实测发现设备级计数器会话由驱动互斥，后来者会立即失败。

最后做成了两个 worker 交错接力：一个 worker 在对方收尾间隙里立即接管，发现计数器被占用就安静退避 0.5 秒。数据点周期从 8 秒压到了大约 4.5 秒。再快就不是加 worker 能解决的了，限制在 nsys CLI 本身的启停和报告落盘流程。

第三：多 worker 下的状态一致性。

`sm_status.json` 是面板和守护进程的边界。如果直接覆盖写，面板可能刚好读到半截 JSON。所以每个 worker 都先写临时文件，再用 `os.replace` 原子替换。读者要么看到上一版，要么看到完整的新版，不会看到中间状态。

#### RTX 5090 上的实测

我把完整的采样数据也放进了仓库，包括 50Hz 的硬件计数器 CSV、`nvidia-smi` 对照采样、环境快照和工具原始输出。

测试环境如下：

- NVIDIA GeForce RTX 5090 32GB，Blackwell GB20x
- Debian 13，Linux 6.12
- NVIDIA 驱动 610.57.04
- Nsight Systems 2026.1.3
- vLLM + Qwen3.6-27B-NVFP4
- MTP 投机解码 2 token，fp8 KV cache
- vLLM 独占 GPU 0，采纯解码窗口

| 指标 | 结果 |
|---|---:|
| GPU-Util 中位数 | 94% |
| GPU-Util 平均值 | 88.3% |
| SM Throughput 平均值 | 5.0% |
| SM Throughput 最大值 | 6.0% |
| 显存带宽 | 67.6% |
| Tensor 管道活跃率 | 5.0% |
| Occupancy | 11.1% |
| 功耗 | 约 478W / 575W TDP |

GPU-Util 和 SM Throughput 相差大约 19 倍。这个结果不能单独当成严格的 roofline 证明，但“SM Throughput 低、Tensor 管道低、显存带宽明显更高”的组合，符合 LLM 解码阶段 memory-bound 的特征。

这时候调优方向就比较清楚了：虽然 GPU-Util 94% ，但是还可以尝试增大 batch 或并发，让多个 token 共享一次权重搬运成本，用显存带宽换聚合吞吐。

#### 采样开销怎么样

守护模式只做 `--trace=none` 硬件计数器采样，不注入推理进程。我用固定任务做了 A/B 对照，无采样时 5 次的吞吐中位数是 105.6 tok/s，50Hz 采样时是 124.6 tok/s。两组样本都在 102–131 tok/s 之间，波动主要来自 MTP 接受率。

小样本实验只能说“没有观察到吞吐下降”，一次性测量模式还会开 CUDA trace，开销特性不同，不应该拿它当常驻监控。

#### 使用方法

工具不需要 Python 第三方依赖，需要 Linux、NVIDIA GPU、Nsight Systems CLI、`python3`、`curl` 和系统级计数器采样权限。RTX 5090 默认使用 `gb20x-top` 指标集，其他架构需要先查询本机可用集，再通过 `METRICS_SET` 覆盖。

```bash
git clone --depth 1 https://github.com/luckyops/sm-efficiency
cd sm-efficiency

# 一键选择本机推理服务、matmul 负载或裸采样
./examples/quickstart.sh

# 常驻监控
./sm_daemon.sh start
./gpu_watch.sh
```

非 GB20x 架构可以这样查看指标集：

```bash
nsys profile --gpu-metrics-set=help
METRICS_SET=<name> GPU_DEVICE=0 ./sm_daemon.sh start
```

#### 我的体验

这个工具解决是避免用错误指标做性能判断。

GPU-Util 适合判断 GPU 有没有长时间空闲，SM Throughput、Tensor 管道、Occupancy、显存带宽，再加上业务侧的 token 吞吐和延迟，合在一起才能说清楚这张卡“有没有吃满”。。

对我这次 RTX 5090 的 LLM 解码负载来说，结论很直观：94% 表示 kernel 几乎一直在跑，5% 表示 SM 顶层吞吐距持续峰值还很远，67.6% 把真正接近瓶颈的显存带宽指了出来。
