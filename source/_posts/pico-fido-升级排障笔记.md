---
title: 新入手了 Picokey，升级和折腾记录
date: 2026-09-17
tags:
---

#### 做个记录

这次给 Pico FIDO 升级，设备是 Raspberry Pi Pico 2，RP2350 芯片，步进批次是 A4（有安全加强），系统是 macOS。

本来只是想让它在 Yubico Authenticator 里正常使用，结果先遇到了刷写权限错误，适配客户端后又发现编译配置漏开了 EdDSA，中间重新构建、刷了几次。

通过 BOOTSEL 磁盘刷入了自己编译的签名固件，**Secure Boot 保持开启，原有账户和 PIN 保留，Yubico Authenticator 可以正常使用。** 把几个容易误判的地方记下来。

#### picotool 报权限错误，不代表不能升级

设备进入 BOOTSEL 后，`picotool info -a` 能正常读取信息，但执行 `picotool load -v` 报错：

```text
Family ID 'rp2350-arm-s' can be downloaded in partition 0:
  00000000->00100000
ERROR: The RP2350 device returned an error: permission failure
```

我最开始以为开启 Secure Boot 后就不能通过 BOOTSEL 刷机了，只能接 SWD。后来把同一份签名 UF2 直接复制到 BOOTSEL 磁盘，设备就正常启动了。

```bash
# 在签名固件所在目录执行
COPYFILE_DISABLE=1 cp -X pico_fido_yubico_signed.uf2 /Volumes/RP2350/
```

所以这次能确认的是：`picotool load` 失败了，但磁盘复制可以更新。具体是哪一步请求被拒绝，没有抓 USB 通信，暂时没有确定。

Secure Boot 验证启动镜像，Flash 能不能写还要看分区权限。这块设备的布局如下，地址是 Flash 内偏移，范围不包含末端：

| 分区 | 范围 | BOOTSEL 非安全访问 |
|---|---|---|
| Firmware | `0x000000–0x100000` | 读、写 |
| Binding | `0x100000–0x102000` | 写 |
| Data | `0x102000–0x400000` | 读 |

这次检查过镜像地址，应用载荷没有覆盖 Binding 和 Data 分区，刷入后原有数据也可以读取。不过新固件运行时仍可能迁移存储格式，不能据此认为所有 UF2 都能保留数据，也不能保证刷回旧版就能恢复原状。

普通升级用不到 nuke、恢复出厂或重新置备 OTP。

#### VID/PID 对了，客户端还是认不出来

本地源码原本就有 FIDO2、OATH、OTP 和管理协议。这次首先要解决的是 USB 身份。

`VIDPID=Yubikey5` 设置了 `1050:0407`，但产品字符串仍然是 `Pico Key`。排查时发现，本机 ykman 的 PC/SC 枚举还会根据读卡器名称中的 `yubico yubikey` 筛选设备。

所以只改 VID/PID 不够，还要把产品名接进构建配置。这次改了以下几处：

| 文件 | 修改内容 |
|---|---|
| `pico-keys-sdk/picokeys_sdk_import.cmake` | 选择 `Yubikey5` 时定义 `PICOKEYS_USB_PRODUCT="yubico yubikey"` |
| `pico-keys-sdk/src/usb/usb_descriptors.c` | 产品字符串使用这个宏，其他构建仍默认 `Pico Key` |
| `src/fido/management.c` | 按编译开关和实际注册的应用报告能力，屏蔽未支持的 enabled 位 |

管理能力也有一个问题。原来 supported 没有 PIV、OpenPGP，enabled 却把它们列了进去：

```text
修改前：supported=0x0223  enabled=0x023b
修改后：supported=0x0223  enabled=0x0223
```

`0x0223` 对应 OTP、U2F、OATH 和 FIDO2。修正后，CCID、FIDO HID、OTP HID 三条连接返回一致，Authenticator 也不再显示没有加入的 PIV、OpenPGP。

这次没有改 CCID 端点和消息长度，原来的配置已经可以通过 macOS PC/SC 工作。如果设备另外保存过持久化 USB 产品名，还要检查 `PHY_USB_PRODUCT` 是否覆盖了固件里的字符串。

#### 编译时别把原有功能关掉

第一版适配构建沿用了旧缓存里的 `ENABLE_EDDSA=OFF`。客户端虽然能识别了，但少了 EdDSA/Ed25519，后来重新打开再编译。

最终配置是：

```text
PICO_BOARD=pico2
VIDPID=Yubikey5
ENABLE_OATH_APP=ON
ENABLE_OTP_APP=ON
ENABLE_EDDSA=ON
ENABLE_POWER_ON_RESET=ON
ENABLE_PQC=OFF
DEBUG_APDU=0
```

开启 EdDSA 后，项目会使用 `polhenarejos/mbedtls` 的 `v3.6.7-eddsa` 版本依赖，不能只加编译宏却继续沿用普通 mbedTLS 源码。

`ENABLE_PQC` 保持关闭。这次使用的 Pico FIDO 应用没有接入这个 SDK 开关对应的 ML-KEM/ML-DSA 协议功能，单独打开依赖开关没有意义。

实机最后报告的算法是：

```text
[-36, -35, -8, -7]
```

其中 `-8` 是 EdDSA，可以用来确认正在运行的已经是最后一版。SECP256K1 是否报告还受设备 PHY 曲线配置影响，这次没有为了把算法列表补齐而修改持久化配置。

#### 构建和签名

这次是从全新克隆的源码重新构建，没有继续复用旧 build 目录。主要版本记在这里，方便以后对照：

| 组件 | 版本 |
|---|---|
| pico-fido | `b8e5e488cf09fca85f64db7ae9238621e1efb401` |
| pico-keys-sdk | `7892b8ce3adf231815e327cd750702c1d59d8931` |
| Raspberry Pi pico-sdk / picotool | `2.1.1` |
| mbedTLS | `v3.6.7-eddsa` |
| ARM 编译器 | xPack GNU Arm Embedded GCC `13.3.1-1.1` |
| CMake | `4.4.3` |

上面的 USB 产品名和管理能力修改是本地补丁，没有提交到上游。**直接 clone 上游再加这些编译参数，不会自动得到本文的适配结果。** 下面只保留应用修改后的关键构建命令，不依赖私人归档里的脚本。

先准备好对应工具链和 `PICO_SDK_PATH`，在已经应用修改的源码根目录执行，使用新的构建目录：

```bash
cmake -S . -B build_yubico_pico2 \
  -DPICO_BOARD=pico2 -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DVIDPID=Yubikey5 \
  -DENABLE_OATH_APP=ON -DENABLE_OTP_APP=ON -DENABLE_EDDSA=ON \
  -DENABLE_POWER_ON_RESET=ON -DENABLE_PQC=OFF \
  -DDEBUG_APDU=0 -DSECURE_BOOT_PKEY=

cmake --build build_yubico_pico2 --parallel 8
```

这里先生成未签名 UF2，再单独签名。`SECURE_BOOT_PKEY` 留空是为了避免构建阶段走另一套自动签名流程，不会关闭设备已经启用的 Secure Boot。

签名复用的是设备已经信任的 **ECDSA secp256k1 私钥**，不是 TLS 证书，也不是 FIDO attestation 证书。不能换成 P-256/secp256r1，更不能新建一个同名 PEM 就当成原来的密钥。

下面的路径是占位示例，需要替换为自己的密钥位置；`picotool` 使用上表版本：

```bash
SIGNING_KEY='/path/to/secure-boot-private-key.pem'

picotool seal --hash --sign \
  build_yubico_pico2/pico_fido.uf2 \
  build_yubico_pico2/pico_fido_yubico_signed.uf2 \
  "$SIGNING_KEY"
```

`picotool seal` 可以直接处理 UF2，不需要先转成 BIN。写入前还要验签，核对板型、可信公钥和镜像写入范围。这次使用的是原有可信密钥，没有重新写入设备的 OTP 安全配置。

#### 刷入后怎么检查

退出占用设备的客户端，拔下设备，按住 BOOTSEL 重新插入。确认出现 `/Volumes/RP2350` 后，先读信息：

```bash
picotool info -a
cat /Volumes/RP2350/INFO_UF2.TXT
```

确认目标设备和 Secure Boot 状态，再复制签名文件：

```bash
COPYFILE_DISABLE=1 cp -X \
  build_yubico_pico2/pico_fido_yubico_signed.uf2 \
  /Volumes/RP2350/
```

这次复制后磁盘消失，设备重新枚举，随后可以正常响应。不要把同目录里的未签名 `pico_fido.uf2` 当成最终文件。

重新打开客户端，检查管理信息和各个应用。下面按只连接一把 Key 的情况写，多设备时用 `ykman -d` 指定目标：

```bash
ykman list
ykman info
ykman fido info
ykman oath info
ykman otp info
```

这次使用 Yubico Authenticator `7.4.1` 和 ykman `5.9.2`，图形界面确认正常，原有账户和 PIN 保留。

升级时的测试记录如下：

| 检查项 | 结果 |
|---|---|
| 三条管理连接 | supported、enabled 均为 `0x0223` |
| 实机 FIDO GetInfo | 返回 EdDSA，以及凭据管理等原有选项 |
| 实机 OATH | TOTP/HOTP 的 SHA-1、SHA-256、SHA-512 结果与本地计算一致 |
| 实机 OTP | 临时 HMAC-SHA1 challenge-response 与本地计算一致 |
| 临时数据清理 | 测试账户和临时槽位配置已清理，原有数据保留 |
| 主机测试 | 6 项通过 |
| 隔离 FIDO 回归 | 228 项通过，1 项跳过 |

FIDO 回归跑在一次性仿真环境里，跳过的是需要分两阶段运行的重启后 silent authentication 用例。没有逐个登录真实网站验证，也没有在日常使用的 Key 上做 reset、修改 PIN 或重新置备。

上游部分测试会重置设备或清理数据，不要直接把整套测试指向自己的日常 Key。

#### macOS 上连不上 OATH，先退出图形客户端

还有一次，Authenticator 能显示账户，命令行却报：

```text
Failed to connect to YubiKey
```

继续查 PC/SC，拿到了更具体的错误：

```text
Sharing violation (0x8010000B)
```

当时是图形客户端的账户或槽位页面占用了智能卡连接。切到通行密钥页，或者直接退出客户端后，`ykman oath info` 就恢复了。

所以我现在会先看产品名、读卡器名是否正确，再排除连接占用，最后检查 CCID 协议。`ykman info` 能成功不代表 OATH 连接一定正常，管理信息也可能是通过 HID 读到的。

重刷后如果客户端页面还停在旧状态，重新打开，再用原 PIN 解锁即可，不需要清空凭据。

#### 目前的限制

这次解决了识别和能力报告，保留了 Pico FIDO 原有的 FIDO2、OATH、OTP 等功能，但 Yubico 管理协议还没有完整适配。

PIV、OpenPGP 没有加入。FIDO HID、OTP HID 的部分管理写入没有补齐，CCID 管理写入和 Management reset 也有待完善。因此不能因为 Authenticator 能显示设备，就认为“启用/禁用应用程序”和“恢复出厂设置”都能按 YubiKey 的方式使用。

这次最容易踩坑的三个地方：

- 开启 Secure Boot 以后，`picotool load` 报错不代表不能升级。
- 客户端能识别以后，就忘了检查构建到底保留了哪些功能。先核对签名和写入范围，刷完再看实际运行的能力与算法列表。
- 需要在几个地方一起做伪装，才能和 Yubico Authenticator 完美适配。


#### 使用体验

**优点**：在常规网站（比如 ChatGPT、Google）的使用体验都很棒，尤其是 ChatGPT 的登录，比 YubiKey 还丝滑一点。

**缺点**：因为没有通过 FIDO 认证，所以不能用在 Apple 的账户上。

我最后手头的设备是：93 RMB 买的 Yubico Security Key（固件 5.4.3）、39 RMB 的开源 picokey、220 RMB 买的 YubiKey 5C NFC（固件 5.4.3）。这些加起来也没有官网买一把全新 Key 贵，但足够把整个体系用起来，可靠性也够。

如果不担心 picokey 用的时间长了可能坏掉，这把 YubiKey 5C NFC 其实也可以暂缓购入，都可以。 