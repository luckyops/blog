---
title: RTX 5090 推理 Qwen3.6-27B 基准 112 tok/s
date: 2026-05-25 16:10:25
---

#### 做个记录

在即将更新qwen3.8-27b之前，先把之前单卡 RTX 5090 跑 Qwen3.6-27B的报告出了，做个存档。  以下是我在 RTX 5090上跑出来的数据。推理 112 tok/s"。

关注的指标如下：TTFT、TPOT、吞吐、并发、显存、KV Cache、投机解码接受。

机器信息：
dev 是台 Debian 机器，插了一张 RTX 5090，32GB 显存，Blackwell 架构 SM120，驱动 610.57.04。上面用 docker-compose 跑着一个 vLLM v0.26.0 的服务，模型是 Qwen3.6-27B 的 NVFP4 量化版，开了 MTP 投机解码（每步草拟 2 个 token），KV Cache 用 fp8 存，max-num-seqs 4。

#### 测试方法

自己写了一个 benchmark 脚本，主要是三个注意点：

第一个是 prefix caching。服务的 prefix caching 是开着的，同一个 prompt 发第二遍，prefill 直接命中缓存，TTFT 会变得虚低。所以每个请求的 prompt 头部都加一个 uuid 盐，保证每次都是真的 prefill。

第二个是输出长度。 min_tokens 设置等于 max_tokens，输出窗口等长。采样用 greedy（temperature=0），排除随机性。

第三个是接受率。MTP 投机解码的吞吐和"草稿被接受的概率"， vLLM 把 draft/accepted 的计数器放在 `/metrics` 里，是累积值。做法就是每档测试前后各抓一次，做差分。

具体负载是两档：短档大约 600 token 输入、512 输出，跑 3 轮取中位数；长档 3000 输入、2048 输出。并发 1、2、3 各测一遍。测试的同时后台每 0.5 秒采一次 nvidia-smi，显存、利用率、功耗。

```bash
python3 ~/bench_ttft.py --base-url http://127.0.0.1:8000 \
  --model qwen3.6-27b-heretic-nvfp4 --out bench_out.json
```

#### 结果：

![](fig1_throughput_vs_concurrency.png)


| 并发 | TTFT | TPOT | 聚合吞吐 | MTP 接受率 | λ |
|---:|---:|---:|---:|---:|---:|
| 1 | 99–148 ms | 9.7 ms | 101–104 tok/s | 48–50% | 1.96–2.01 |
| 2 | 167–275 ms | 9.3–9.7 ms | 199–208 tok/s | 50–56% | 2.00–2.12 |
| 3 | 178–421 ms | 9.6–10.1 ms | 288–298 tok/s | 51–56% | 2.03–2.12 |


![](fig2_ttft_tpot.png)


![](fig3_spec_acceptance.png)


#### 显存占用

![](fig4_vram_power.png)

32GB 的卡，vLLM 按 `gpu-memory-utilization 0.922` 预留了 28.95 GiB，

权重（NVFP4）18.65 GiB，KV Cache（fp8）7.02 GiB，峰值激活 2.96 GiB，CUDA Graph 0.09 GiB


测试时 nvidia-smi 的 GPU-Util 是 92–94%，但之前我在这台机器上用 Nsight 硬件计数器做过分析（就是 [sm-efficiency](https://github.com/luckyops/sm-efficiency) 那个工具）：解码阶段真实的 SM throughput 只有 5% 上下，显存带宽用到 67.6%。GPU-Util 高只说明"SM 上有 kernel 在跑"，解码是显存带宽在搬权重，计算单元在旁边等数据。


#### 体验

112 tok/s 里面，MTP是最大的提升，Nvidia的生态优势确实大。  
比我测试 AMD PRO R9700目前还是纯硬算 27 tok/s，差距肉眼可见。
