---
title: RTX 5090 从 Qwen3.6-27B 升到 Qwen3.8-27B：4 并发 366 tok/s
date: 2026-08-24 20:15:00
tags:
---

#### 做个记录

前两天刚把单卡 RTX 5090 跑 Qwen3.6-27B 的数据整理完，dev 上的模型就换成了 Qwen3.8-27B。

中间折腾了两轮配置。最开始按模型卡跑 192K 上下文、单并发和 MTP n=3，后来根据实际的字幕、图书翻译负载，改回了 65K 上下文、最大 4 并发。最后又把 MTP n=3 和 n=2 做了一次 A/B。

最终结论：**MTP n=2 更适合现在这套翻译配置。** 单路、双路和三路吞吐与 n=3 持平或略高，四并发在本文短档基准里跑到 366 tok/s；同时 KV Cache 多出将近 1 万 token，每步还少一个草拟位置。

服务现在已经固定在 n=2，正确性回归重新跑过，API health 返回 200。

#### 最终配置

机器还是 Debian 13、RTX 5090 32GB、驱动 610.57.04。模型换成 `lyf/Qwen3.8-27B-Heretic-ARA-NVFP4-MTP-VL`，只启用语言模型部分。

最终参数如下：

```text
模型                    lyf/Qwen3.8-27B-Heretic-ARA-NVFP4-MTP-VL
量化                    compressed-tensors NVFP4
vLLM 镜像                vllm/vllm-openai@sha256:d392f621bb3e372ecc09f0b0cb88099afe9fa05d37a0450de45eeb8c12b6787e
MAX_MODEL_LEN           65536
MAX_NUM_SEQS            4
MAX_NUM_BATCHED_TOKENS  8192
GPU_MEMORY_UTILIZATION  0.95
KV_CACHE_DTYPE          fp8
MTP_TOKENS              2
```

prefix caching、chunked prefill、`language-model-only`、qwen3 reasoning parser、qwen3_xml tool parser 和 thinking off 都保留。默认采样参数仍然是 temperature 0.2、top_p 0.95、top_k 20；基准测试单独使用 greedy。

推理镜像从 Qwen3.6 时的 vLLM v0.26.0 换成了模型作者指定并按上面 digest 固定的镜像；这个镜像内部报告的实际引擎版本是 `v0.1.dev19754+g3a0914114`。一个是容器镜像身份，一个是镜像里的 vLLM 版本，并不矛盾。NVFP4 不再手工指定 `--quantization modelopt`，由 compressed-tensors 自动识别，5090 上使用 FlashInfer CUTLASS NVFP4 kernel。

这里有个容易误解的地方：Qwen3.6 和这次 Qwen3.8 的 `config.json` 里，架构名都还是 `Qwen3_5ForConditionalGeneration`。两边都是 64 层、每 4 层一次 full attention、带 1 层 MTP，hidden size、词表和 attention heads 也一样。

所以这次更准确地说是换 checkpoint、量化格式和推理运行时，不是底层网络结构整个换了一代。文章里的 3.6 和 3.8 也是具体社区模型的命名，不能直接外推到所有同名模型。

#### 为什么没有继续用 192K 单路

模型卡给出的文本 profile 是 192K 上下文、`max_num_seqs=1`。这个配置适合一条超长对话，但我的实际任务是字幕和图书翻译，典型负载大约 31K token 输入、8K token 输出。

我在 192K、`max_num_seqs=1` 这套 profile 下记录到的单路输出大约是 100–135 tok/s。因为引擎一次只调度一条序列，队列里再多任务也不能形成多路 batch。改成 65,536 上下文后，每个真实任务仍有大约 33K token 的输出余量，同时 `max_num_seqs=4` 可以让多条翻译任务一起 batch。

所以最后沿用了 Qwen3.6 上验证过的翻译 profile：

```text
MAX_MODEL_LEN           196608 → 65536
MAX_NUM_SEQS                 1 → 4
MAX_NUM_BATCHED_TOKENS    4096 → 8192
```

这个取舍不是追求模型能塞进去的最大上下文，而是让上下文容量和实际任务匹配，把剩下的显存与调度空间换成聚合吞吐。

#### 先把 MTP 参数化

为了不在每次切换 n 值时修改 Compose，先把 speculative config 的深度放进 `.env`：

```dotenv
MTP_TOKENS=2
```

`compose.yaml` 只引用变量：

```yaml
- --speculative-config
- '{"method":"mtp","num_speculative_tokens":${MTP_TOKENS}}'
```

以后切换只需要修改 `.env`，再重新创建容器：

```bash
docker compose up -d
```

我用 `docker compose config` 检查了最终渲染结果，也从正在运行的容器命令和 vLLM 启动日志交叉确认。三处结果分别是：

```text
compose:  {"method":"mtp","num_speculative_tokens":2}
container command:  "num_speculative_tokens":2
vLLM engine log:    num_spec_tokens=2
```

当前确实是 n=2，不是只改了文件但容器还在跑旧参数。

#### 正确性回归

换 MTP 深度不能只看 tok/s。n=2 启动后先跑了正确性测试，再跑性能基准。

第一组 smoke test 是首都、乘法和《孙子兵法》三个问题，3/3 通过。

第二组是 6 项长上下文回归：

- 9,988 token 的 needle 冷缓存检索正确；
- 相同请求热缓存输出逐字一致；
- 第二次热缓存仍保持确定性；
- 部分 prefix cache 命中后，变化的尾部问题回答正确；
- 长文生成冷、热输出逐字一致，长度 710 字符，没有重复退化；
- 多轮增长上下文里的口令、丢包率和响应时间都能正确取回，重复请求结果一致。

本文列出的 smoke 用例 3/3、regression 用例 6/6。这个验证主要防的是 MTP、长上下文和 prefix caching 组合下的静默重复、needle 丢失及冷/热输出分歧；它不等于真实翻译质量和长期稳定性也已经验证完毕。

#### MTP n=2 和 n=3 A/B

基准脚本没有改：每个请求加 uuid 盐避开 prefix cache，`min_tokens=max_tokens` 固定输出长度，temperature=0，并从 vLLM metrics 前后差分计算 MTP 接受率。GPU 每 0.5 秒采样一次。

稳定档输入约 400 token、输出 512 token，并发 1、2、3 各跑 3 轮取聚合吞吐中位数。n=2 另外补了 `max_num_seqs=4` 的上限档位。

| MTP | c1 | c2 | c3 | c4 | 接受率 | λ | KV tokens | 65K 满上下文并发 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| n=3 | 100 | 179 | 271 | — | 38–39% | 2.14–2.18 | 174,372 | 2.66× |
| **n=2** | **102** | **188** | **276** | **366** | 50–51% | 2.01–2.03 | **184,242** | **2.81×** |

n=2 的并发 4 三轮在 358–377 tok/s，聚合中位数 366 tok/s，TPOT 仍在 10.3ms 左右。在这套短档、这版软件栈和当前采样方法下，吞吐从单路 102 tok/s 扩到四路 366 tok/s，线性度大约 90%。它证明 `max_num_seqs=4` 可以实际运行，但不是对生产负载稳定吞吐的保证；n=3 没有补测 c4，也不能据此比较两者的四并发性能。

这里的接受率分母是所有草稿 token，λ 是 `1 + 每次验证平均接受的草稿 token 数`。n=3 虽然 λ 更高，但并不代表 tokens/ms 更高。

n=3 的三个位置接受率大约是 62%、35% 和 20%。vLLM 在 n>1 时的启动日志明确警告，同一个 MTP 层会为多个 speculative token 重复前向；结合第三个位置只有约五分之一能被接受，以及实测吞吐没有提高，我判断这个位置的边际 token 基本被额外开销吃掉了。这是由引擎日志和 A/B 数据支持的工程判断，不是 kernel trace 得出的严格归因。

n=2 的 TPOT 大约 9.5–10.3ms，n=3 是 9.6–10.9ms。差距不算大，但方向是一致的：少做一次低收益的草拟，吞吐没有损失，生成阶段的平均每 token 时间还略好。

#### KV Cache 反而更多

n=3 时 vLLM 报告 174,372 KV tokens，65K 满上下文并发 2.66×。改成 n=2 后，当前 metrics 报告：

```text
kv_cache_size_tokens=184242
kv_cache_max_concurrency=2.811320754716981
```

也就是多了 9,870 token，满上下文并发从 2.66× 增加到 2.81×。真实的 31K 输入、8K 输出任务不会每路都吃满 65K，所以实际可 batch 的任务数还会更高，最终仍由 `max_num_seqs=4` 限制。

n=2 测试期间 nvidia-smi 的稳态显存是 31,268 MiB，和 n=3 的 31,280 MiB 基本一样。收益不在于让 nvidia-smi 突然少几个 GiB，而是相同显存预算里，vLLM 能给业务 KV Cache 多切一点空间。

#### 长输出为什么不能拿来排名

长档约 1,900 token 输入、2,048 token 输出，每个并发只跑了 1 轮。n=2 的 c1 是 101 tok/s，但 c2 跳到 287 tok/s，c3 最高见到 408 tok/s。

这个跨度来自输出内容。greedy 生成一旦落入容易预测的种子段落模式，MTP 接受率会从约 51% 跳到 98%，λ 接近 n=2 的理论上限 3；没有进入这个模式时，速度就回到约 100 tok/s。

Qwen3.6 之前也出现过类似双峰。单轮长档更适合说明“MTP 对输出内容非常敏感”，不适合拿来判断 n=2 和 n=3 谁更快。真正用于 A/B 决策的是三轮中位数的稳定短档，408 tok/s 只能算观察到的峰值，不能当日常吞吐宣传。

#### 显存和功耗

Qwen3.8 n=2 的模型加载显存约 18.41 GiB，KV Cache 是 184,242 token。与 Qwen3.6 的记录放在一起看：

| 项目 | Qwen3.6 n=2 | Qwen3.8 n=2 |
|---|---:|---:|
| 模型加载显存 | 18.65 GiB | 18.41 GiB |
| KV Cache token 数 | 166,931 | 184,242 |
| nvidia-smi 稳态占用 | 32,108 MiB | 31,268 MiB |
| 短档聚合吞吐 c1/c2/c3 | 101 / 198 / 288 | 102 / 188 / 276 |

Qwen3.8 单路与 Qwen3.6 基本打平，双路和三路略低，但多出了已经验证的四并发 366 tok/s。两边的引擎、量化后端和显存预算也不完全一样，所以这张表只能描述两套最终部署，不能把差异全部归因到 checkpoint。

功耗方面，Qwen3.8 n=2 短档中位数约 478–496W，仍然高于 Qwen3.6 的 401–416W。n=2 比 n=3 少一次草拟前向，但这轮数据还不足以把功耗差异单独归因到 MTP 深度；checkpoint、vLLM 和量化加载后端也都变了。

#### 最后的选择

最终保留 MTP n=2，原因有四个：

1. 稳定短档 c1–c3 吞吐与 n=3 持平或略高；
2. 并发 4 可以线性扩展到 366 tok/s；
3. KV Cache 多 9,870 token，满上下文并发从 2.66× 增到 2.81×；
4. 少一个低接受率的草拟位置，TPOT 略好，而且本文列出的正确性回归全部通过。

这也回到了 Qwen3.6 翻译负载验证过的 `spec-tokens=2`。模型卡给出的 n=3、192K 单路 profile 与我现在的 65K、多并发翻译负载不同；在当前 profile 的实测里，n=3 没有净收益。

原始 n=2 数据保存在 dev 的 `~/bench_qwen38_mtp2.json`。192K 单路配置保存在 `.env.baseline-192k-singleseq-20260825`，参数化前的 Compose 也有 `compose.yaml.bak.20260825`，需要时可以回滚。

这次升级最后得到的结论不是“Qwen3.8 比 Qwen3.6 快多少”，而是配置必须跟负载走。对我这套 RTX 5090 翻译服务来说，65K 上下文、4 并发和 MTP n=2，才是容量、延迟和聚合吞吐之间更合适的点。
