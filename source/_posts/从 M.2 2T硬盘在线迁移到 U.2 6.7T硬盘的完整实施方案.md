---
title: PVE：将系统与 local-lvm 从 M.2 2T硬盘在线迁移到 U.2 6.7T硬盘的完整实施方案
date: 2026-08-13 23:52
tags:
---

前一阵子做了个大活儿，把 PVE 9.2.11 的系统热迁移到另外一个磁盘，最后的结果很成功，全流程做一个记录。

## 1. 审查结论与关键修订

原方案的总体方向正确：保持 VG/LV 名称不变，通过在线 `pvmove` 迁移整个 `pve` VG，再重建 U.2 ESP。

但必须修正以下问题：

1. **先迁移并建立新 ESP，成功从 U.2 引导后，再执行 `vgreduce`**
   - 原方案在新 ESP 尚未验证前就移除 M.2 PV，风险顺序不合理。
   - 修订后，M.2 PV 在第一次 U.2 引导验证前仍保留在 VG 中，便于反向 `pvmove`。

2. **M.2 不能视为完整数据回滚盘**
   - `pvmove` 完成后，根 LV、thinpool、swap 的有效区段已经在 U.2。
   - M.2 ESP仍可作为临时引导入口，但启动后实际读取的是 U.2 上的 `pve-root`。
   - 它不是可独立启动的旧系统副本。

3. **不创建 BIOS Boot 分区，不安装 `i386-pc` GRUB**
   - 当前主机明确使用 UEFI。
   - BIOS Boot 分区对 UEFI 无作用。
   - NVMe、4Kn 和传统 BIOS 的组合也没有必要作为恢复路径。
   - U.2 只建立 ESP 和 LVM PV 两个分区。

4. **不硬编码 `2048` 扇区**
   - 在 4Kn 设备上，2048 个逻辑扇区是 8 MiB，虽然仍然对齐，但没有必要。
   - 使用 `sgdisk` 的自动对齐，并通过 `parted align-check optimal` 验证。

5. **不指定 `pvcreate --metadatasize 1M`**
   - LVM 默认 metadata area 足够，且会根据设备扇区和对齐自动处理。
   - 手工指定 1 MiB 没有收益。
   - 使用默认 `pvcreate`，随后检查 `pe_start` 和对齐。

6. **`pvmove` 可以在线搬迁 thinpool**
   - `pvmove` 搬的是底层物理区段，会处理 `data_tdata`、`data_tmeta`、根 LV、swap、快照和模板基。
   - 不需要手工先搬 metadata 再搬 data。
   - 不会触发 thinpool 扩容或缩容。
   - 必须在完成后确认 M.2 上没有任何残留区段，再执行 `vgreduce`。

7. **使用 `proxmox-boot-tool` 管理新 ESP**
   - 不手工混用 `grub-install`、`bootctl` 和复制 loader entry。
   - 当前实际引导链是 GRUB + shim，因此初始化新 ESP 时明确使用 `grub` 模式。
   - `systemd-boot` 的旧 NVRAM 项不是本次目标，不需要同步或重建。

8. **第一次重启使用 `BootNext`，不是立即重写永久 `BootOrder`**
   - 首次仅让下一次启动从 U.2。
   - 只有确认 `BootCurrent` 确实是 U.2 后，才把新条目置于 `BootOrder` 首位。

9. **备份空间门槛修正**
   - `lvcreate -L 2T` 要求 `hdd-data` 至少有 2 TiB 可用空间，原方案的“≥1.2T”明显不成立。
   - 还要为 HDD thinpool 自动扩展保留空间，不能把 VG 剩余空间全部分配给备份 LV。

10. **HDD 上的 guest 备份到同一块 HDD 可以执行，但不是独立故障域**
    - LVM 和 `vzdump` 不会因此产生锁冲突。
    - 但 VM 105/113/117/120/121/122 的源盘与备份目标位于同一物理 HDD，无法防御 HDD 本身故障。
    - 它们只能防御本次误操作和配置损坏。
    - 若要真正保护这些 VM，备份目标必须是另一块物理盘或远端存储。

11. **不把临时备份目录注册成 PVE storage**
    - 使用 `vzdump --dumpdir` 更安全。
    - 避免备份 LV 未挂载时，PVE 把备份写进根文件系统中的空目录。

---

## 2. 迁移方法选择

### 2.1 采用方案：在线 `pvmove`

优点：

- guest 无需停机；
- VG 名 `pve`、LV 名、thinpool、快照链、linked clone 关系全部保持不变；
- `/etc/pve/storage.cfg` 中 `local-lvm` 无需改名；
- 根文件系统、swap、thinpool 可一次性迁移；
- 不需要重装系统或逐 guest 迁盘。

主要风险：

- 迁移时间长，期间对两块 NVMe 有持续读写压力；
- 不是块级旧盘克隆，完成后 M.2 不能作为独立系统副本；
- 第一次 U.2 引导验证前不能拔盘或移除旧 PV。

### 2.2 不采用：整盘 `dd`

不推荐，原因：

- 源盘 2 TB、目标盘 7.68 TB，复制后仍需修复备份 GPT 并扩展分区、PV、VG/thinpool；
- 会复制 GPT GUID、PARTUUID、ESP UUID、LVM PV UUID，源盘和目标盘同时在线时会产生重复身份；
- 不能在源系统持续写入时安全地获得一致的整盘副本；
- 迁移 2 TB 原始空间，而不是仅迁移已分配 LVM 区段。

### 2.3 不采用：`rsync` 根文件系统 + chroot

不推荐，原因：

- 只能处理根文件系统，无法自然保留 thinpool、快照、linked clone 和模板基；
- 需要单独迁移全部 guest 盘；
- 更容易遗漏 initramfs、LVM、EFI、权限、ACL、xattr 和 PVE 配置状态。

---

## 3. 强制执行原则

- 必须具备 **IPMI/KVM 或现场控制台**，不能只依赖 SSH。
- 所有破坏性命令执行前必须重新核对设备型号、序列号和容量。
- 本次勘察中：
  - U.2：`/dev/nvme0n1`，WDC 7.68 TB，目标盘；
  - M.2：`/dev/nvme1n1`，ZHITAI 2 TB，源盘。
- NVMe 节点名可能在重启后变化。重启后禁止仅凭 `nvme0n1`/`nvme1n1` 判断物理盘。
- `pvmove`、ESP 初始化、首次 U.2 引导、`vgreduce`，每一步都有独立门槛；任一门槛失败立即停止。

---

## Task 0：前置检查、备份和配置快照

### Step 0.1：进入持久会话并确认控制台

```bash
ssh root@10.0.1.151
tmux new -s migrate-pve1
```

确认：

- IPMI/KVM 或现场显示器可以进入 UEFI；
- 已知 UEFI Boot Manager 的进入方式；
- 当前 SSH 不经过待迁移 guest 提供的网络基础设施。

---

### Step 0.2：确认主机、磁盘身份和引导模式

```bash
hostname
pveversion -v
uname -a

test -d /sys/firmware/efi && echo "UEFI mode" || echo "NOT UEFI"

lsblk -e7 -o NAME,PATH,SIZE,MODEL,SERIAL,LOG-SEC,PHY-SEC,TYPE,FSTYPE,MOUNTPOINTS
nvme list
ls -l /dev/disk/by-id/ | grep -E 'nvme|WDC|ZHITAI'

blockdev --getss /dev/nvme0n1
blockdev --getpbsz /dev/nvme0n1
blockdev --getioopt /dev/nvme0n1

findmnt /
findmnt /boot/efi
swapon --show
```

#### 验证门槛

必须确认：

- `/dev/nvme0n1` 是 WDC 7.68 TB U.2；
- `/dev/nvme1n1` 是 ZHITAI 2 TB M.2；
- 当前处于 UEFI 模式；
- `/` 是 `/dev/mapper/pve-root`；
- `/boot/efi` 当前位于 M.2 ESP；
- swap 是 `/dev/pve/swap`。

如果设备身份有任何不确定，停止。

---

### Step 0.3：检查命令和软件包

```bash
for cmd in \
  pvs vgs lvs pvcreate vgextend pvmove vgreduce vgcfgbackup \
  sgdisk partprobe mkfs.vfat efibootmgr \
  proxmox-boot-tool vzdump zstd smartctl; do
    command -v "$cmd" || echo "MISSING: $cmd"
done

dpkg -l | grep -E \
  'gdisk|dosfstools|lvm2|efibootmgr|grub-efi-amd64|shim-signed|proxmox-kernel-helper'
```

如缺少必要工具：

```bash
apt update
apt install gdisk dosfstools lvm2 efibootmgr smartmontools
```

不得为了本次迁移安装 `grub-pc` 或运行 `grub-install --target=i386-pc`。

---

### Step 0.4：建立只读状态快照

```bash
SNAP=/root/migrate-snapshot-$(date +%F-%H%M%S)
mkdir -p "$SNAP"

lsblk -e7 -o NAME,PATH,SIZE,MODEL,SERIAL,LOG-SEC,PHY-SEC,TYPE,FSTYPE,MOUNTPOINTS \
  > "$SNAP/lsblk.txt"
lsblk -f > "$SNAP/lsblk-f.txt"
blkid > "$SNAP/blkid.txt"

pvs -a -o pv_name,pv_uuid,pv_size,pv_free,pv_used,vg_name,pe_start \
  > "$SNAP/pvs.txt"
pvs --segments -o pv_name,pvseg_start,pvseg_size,lv_name,segtype \
  > "$SNAP/pvs-segments.txt"
vgs -a -o +devices > "$SNAP/vgs.txt"
lvs -a -o lv_name,lv_attr,lv_size,pool_lv,origin,data_percent,metadata_percent,devices \
  > "$SNAP/lvs.txt"

dmsetup ls --tree > "$SNAP/dmsetup-tree.txt"
cat /etc/fstab > "$SNAP/fstab.txt"
cat /etc/pve/storage.cfg > "$SNAP/storage.cfg"
cat /etc/network/interfaces > "$SNAP/interfaces"
efibootmgr -v > "$SNAP/efibootmgr-v.txt"
proxmox-boot-tool status > "$SNAP/proxmox-boot-tool-status.txt" 2>&1 || true
cat /etc/kernel/proxmox-boot-uuids \
  > "$SNAP/proxmox-boot-uuids.txt" 2>/dev/null || true

cp -a /boot/grub/grub.cfg "$SNAP/grub.cfg"
tar --xattrs --acls -cpf "$SNAP/etc-pve.tar" /etc/pve
tar --xattrs --acls -cpf "$SNAP/etc-lvm.tar" /etc/lvm
cp -a /var/lib/pve-cluster/config.db "$SNAP/config.db"

qm list > "$SNAP/qm-list.txt"
pct list > "$SNAP/pct-list.txt"
pvesm status > "$SNAP/pvesm-status.txt"
pvesh get /cluster/resources --type vm --output-format json \
  > "$SNAP/cluster-resources.json"

for id in $(qm list | awk 'NR > 1 {print $1}'); do
  qm config "$id" > "$SNAP/qm-$id.conf"
done

for id in $(pct list | awk 'NR > 1 {print $1}'); do
  pct config "$id" > "$SNAP/pct-$id.conf"
done

smartctl -x /dev/nvme0n1 > "$SNAP/smart-u2.txt"
smartctl -x /dev/nvme1n1 > "$SNAP/smart-m2.txt"

vgcfgbackup -f "$SNAP/vgcfgbackup-pve" pve
vgcfgbackup -f "$SNAP/vgcfgbackup-hdd-data" hdd-data
```

#### 注意事项

`/etc/pve` 是 `pmxcfs`，逻辑导出和 `/var/lib/pve-cluster/config.db` 都保留，不能只依赖一个普通 `cp -a /etc/pve`。

---

### Step 0.5：确认 guest 不直接引用待拆 M.2

```bash
grep -RniE \
  'nvme1n1|ZHITAI|6f509cda-808f-47f7-9208-145930099c70|3FDA-13B5' \
  /etc/pve/qemu-server /etc/pve/lxc || true
```

#### 验证门槛

不能有 guest 将 M.2 本体、M.2 分区、M.2 by-id 路径作为 passthrough 设备。

如果存在，必须先从 guest 配置中解决，不能继续迁移。

---

### Step 0.6：检查 HDD VG 和 thinpool 空间

```bash
vgs hdd-data -o vg_name,vg_size,vg_free --units t
lvs -a hdd-data \
  -o lv_name,lv_attr,lv_size,data_percent,metadata_percent,segtype
pvesm status
```

#### 备份空间硬门槛

如果要创建 2 TiB thick LV：

- `hdd-data` 的 `vg_free` 必须大于 2 TiB；
- 创建后还必须给现有 HDD thinpool 保留足够的自动扩展余量；
- HDD thinpool 的 `data_percent` 和 `metadata_percent` 必须处于安全范围；
- 不能因为创建备份 LV 耗尽 VG free，导致 thinpool 无法 autoextend。

推荐至少满足：

```text
hdd-data 当前 VG free >= 2.5 TiB
```

如果不满足，不得强行创建 2 TiB LV。应改用另一块磁盘或远端备份存储。

---

### Step 0.7：创建临时 HDD 备份 LV

仅在 Step 0.6 通过后执行：

```bash
lvcreate -L 2T -n migrate-backups hdd-data
mkfs.ext4 -F -L migrate-backups /dev/hdd-data/migrate-backups

mkdir -p /mnt/hdd-backups
mount /dev/hdd-data/migrate-backups /mnt/hdd-backups

findmnt /mnt/hdd-backups
df -hT /mnt/hdd-backups
```

#### 注意事项

- 这是 thick LV，不使用现有 HDD thinpool。
- 不执行 `pvesm add dir`。
- 不写入 `/etc/fstab`。
- 通过 `--dumpdir` 直接备份，避免挂载丢失后误写根分区。

---

### Step 0.8：执行全部 guest 备份

```bash
VMIDS=$(
  {
    qm list | awk 'NR > 1 {print $1}'
    pct list | awk 'NR > 1 {print $1}'
  } | sort -n -u | xargs
)

printf '待备份 VMID：%s\n' "$VMIDS"

vzdump $VMIDS \
  --dumpdir /mnt/hdd-backups \
  --mode snapshot \
  --compress zstd \
  --remove 0 \
  --mailnotification failure
```

#### 说明

- QEMU 在线备份由 QEMU block backup 完成，不要求目标存储支持快照。
- LXC 位于 LVM-thin 时支持 snapshot 模式。
- QEMU guest 没有 guest agent 时通常只有崩溃一致性，不是数据库应用一致性。
- VM 105/113/117/120/121/122 的源盘和备份目标在同一块 HDD 上：
  - 不存在 LVM 锁冲突；
  - 会产生较高的同盘读写负载；
  - 不能防御 HDD 硬件故障；
  - 只能作为本次迁移的逻辑恢复点。

#### 验证门槛

```bash
find /mnt/hdd-backups -maxdepth 1 -type f -name 'vzdump-*' -ls
grep -R "ERROR:" /var/log/vzdump/ || true
df -h /mnt/hdd-backups
```

校验压缩流：

```bash
find /mnt/hdd-backups -maxdepth 1 -type f -name '*.zst' -print0 |
  xargs -0 -n1 zstd -t
```

生成校验和：

```bash
(
  cd /mnt/hdd-backups
  sha256sum vzdump-* > SHA256SUMS
)
```

必须满足：

- 每个 VM/CT 都有对应备份；
- 所有备份任务最终状态为 `TASK OK`；
- `zstd -t` 全部通过；
- 备份目标未接近满盘。

任一 guest 备份失败，不得继续。

---

### Step 0.9：复制主机配置快照到 HDD

```bash
cp -a "$SNAP" /mnt/hdd-backups/
sync

find /mnt/hdd-backups/"$(basename "$SNAP")" -maxdepth 1 -type f -ls
```

---

## Task 1：清除 U.2 旧空 VG 并重新分区

### Step 1.1：再次确认 U.2 没有有效数据和配置引用

```bash
pvesm status
cat /etc/pve/storage.cfg

lvs -a u2-ssd \
  -o lv_name,lv_attr,lv_size,data_percent,metadata_percent,devices
pvs --segments \
  -o pv_name,pvseg_start,pvseg_size,lv_name,segtype |
  grep -E 'nvme0n1|u2-ssd' || true

grep -Rni 'u2-ssd' /etc/pve || true
findmnt -S /dev/nvme0n1 || true
```

#### 验证门槛

必须确认：

- `u2-ssd` 中只有空 thinpool 结构；
- 没有任何 guest volume；
- 没有任何 guest 配置或 storage 配置仍引用它；
- U.2 没有挂载文件系统。

---

### Step 1.2：移除 PVE storage 定义

仅当 `/etc/pve/storage.cfg` 中确实存在 ID 为 `u2-ssd` 的存储时：

```bash
pvesm remove u2-ssd
```

然后验证：

```bash
grep -Rni 'u2-ssd' /etc/pve || true
pvesm status
```

如果 storage ID 不是 `u2-ssd`，必须使用实际 ID，不能把 VG 名当作 storage ID 猜测。

---

### Step 1.3：最后一次核对设备身份

```bash
lsblk -d -o NAME,PATH,SIZE,MODEL,SERIAL,LOG-SEC,PHY-SEC \
  /dev/nvme0n1 /dev/nvme1n1
```

预期：

- `/dev/nvme0n1`：WDC，约 7.68 TB；
- `/dev/nvme1n1`：ZHITAI，约 2 TB。

---

### Step 1.4：删除 U.2 上的旧 VG/PV

```bash
vgremove -y u2-ssd
pvremove -ff -y /dev/nvme0n1

wipefs -a /dev/nvme0n1
sgdisk --zap-all /dev/nvme0n1

udevadm settle
```

验证：

```bash
pvs
vgs
wipefs /dev/nvme0n1
```

---

### Step 1.5：建立 GPT、ESP 和 LVM 分区

计算 1 MiB 对齐对应的逻辑扇区数：

```bash
LOGICAL_SECTOR=$(blockdev --getss /dev/nvme0n1)
ALIGN_SECTORS=$((1048576 / LOGICAL_SECTOR))

printf '逻辑扇区：%s bytes，对齐：%s sectors\n' \
  "$LOGICAL_SECTOR" "$ALIGN_SECTORS"
```

建立分区：

```bash
sgdisk --clear \
  --set-alignment="$ALIGN_SECTORS" \
  --new=1:0:+1G \
  --typecode=1:EF00 \
  --change-name=1:EFI \
  --new=2:0:0 \
  --typecode=2:8E00 \
  --change-name=2:PVE-LVM \
  /dev/nvme0n1

partprobe /dev/nvme0n1
udevadm settle

sgdisk -p /dev/nvme0n1
lsblk -o NAME,START,SIZE,TYPE,FSTYPE,PARTTYPE,PARTLABEL /dev/nvme0n1
```

检查对齐：

```bash
parted -s /dev/nvme0n1 align-check optimal 1
parted -s /dev/nvme0n1 align-check optimal 2
```

#### 预期输出

两个检查都应输出：

```text
1 aligned
2 aligned
```

#### 4Kn 说明

- 如果逻辑扇区为 4096 字节，1 MiB 对齐对应 256 个逻辑扇区。
- 原方案的 `2048` 扇区不会错位，但会从 8 MiB 开始，没有必要。
- ESP 的 FAT32 可以正常工作在 4Kn 设备上。

---

### Step 1.6：初始化 U.2 LVM PV

```bash
pvcreate /dev/nvme0n1p2

pvs /dev/nvme0n1p2 \
  -o pv_name,pv_uuid,pv_size,pv_free,pe_start,vg_name
```

#### 验证门槛

- PV 大小接近 U.2 剩余容量；
- `vg_name` 为空；
- `pv_free` 接近 `pv_size`；
- `pe_start` 正常且已对齐。

不需要设置 `--metadatasize 1M`。

---

## Task 2：将 U.2 PV 加入 `pve` VG

### Step 2.1：检查目标容量

```bash
pvs /dev/nvme1n1p3 /dev/nvme0n1p2 \
  -o pv_name,pv_size,pv_used,pv_free,vg_name

vgs pve \
  -o vg_name,vg_size,vg_free,pv_count,lv_count
```

#### 验证门槛

U.2 PV 的可用空间必须明显大于 M.2 PV 的 `pv_used`。

---

### Step 2.2：扩展 VG

```bash
vgextend pve /dev/nvme0n1p2

vgs pve \
  -o vg_name,vg_size,vg_free,pv_count,lv_count

pvs \
  -o pv_name,pv_uuid,vg_name,pv_size,pv_used,pv_free
```

#### 预期

- `pve` 的 `pv_count=2`；
- U.2 PV 属于 `pve`；
- U.2 有足够空闲区段。

保存新 LVM 元数据：

```bash
vgcfgbackup -f "$SNAP/vgcfgbackup-pve-after-vgextend" pve
```

---

## Task 3：在线执行 `pvmove`

### Step 3.1：迁移前检查 thinpool 健康状态

```bash
lvs -a pve \
  -o lv_name,lv_attr,lv_size,pool_lv,origin,data_percent,metadata_percent,segtype,devices

dmsetup status pve-data-tpool
dmesg -T | tail -n 100
```

#### 验证门槛

- thinpool 未显示 `error`、`fail`、`out of data space`；
- `data_percent` 和 `metadata_percent` 均未接近 100%；
- 没有 NVMe I/O 错误；
- 所有 guest 当前状态已记录。

---

### Step 3.2：记录源 PV 区段

```bash
pvs --segments /dev/nvme1n1p3 \
  -o pv_name,pvseg_start,pvseg_size,lv_name,segtype
```

---

### Step 3.3：开始在线迁移

在 tmux 前台执行：

```bash
pvmove --interval 10 \
  /dev/nvme1n1p3 \
  /dev/nvme0n1p2
```

另开一个 tmux 窗口监控：

```bash
watch -n 10 '
  pvs -o pv_name,pv_used,pv_free,vg_name;
  echo;
  lvs -a pve -o lv_name,lv_attr,data_percent,metadata_percent,copy_percent,devices
'
```

同时监控内核错误：

```bash
journalctl -kf
```

#### thinpool 说明

`pvmove` 会搬迁：

- `pve-root`；
- `pve-swap`；
- `pve/data_tdata`；
- `pve/data_tmeta`；
- thinpool 的 spare metadata；
- 所有 thin volume、快照、模板基和 linked clone 所依赖的底层区段。

不需要：

- 手工先搬 `tmeta`；
- 停止 thinpool；
- 调整 thinpool 大小；
- 逐 VM 执行 `qm move_disk`。

`pvmove` 不会引发 thinpool resize。

---

### Step 3.4：中断处理

如果 SSH 断开但主机仍工作：

```bash
tmux attach -t migrate-pve1
```

检查是否存在未完成的迁移：

```bash
pvmove
lvs -a -o lv_name,lv_attr,copy_percent,devices pve
```

仅在确认必须取消时：

```bash
pvmove --abort
```

不要在不清楚迁移状态时执行 `lvremove`、`vgreduce` 或重启。

---

### Step 3.5：迁移完成后的严格验证

```bash
pvs \
  -o pv_name,vg_name,pv_size,pv_used,pv_free

pvs --segments /dev/nvme1n1p3 \
  -o pv_name,pvseg_start,pvseg_size,lv_name,segtype

lvs -a pve \
  -o lv_name,lv_attr,lv_size,pool_lv,origin,data_percent,metadata_percent,devices
```

必须执行无过滤的完整检查，然后再执行辅助检查：

```bash
lvs -a -o lv_name,devices pve | grep 'nvme1n1p3' || true
lvs -a -o lv_name,devices pve | grep 'nvme0n1p2'
```

#### 硬门槛

必须同时满足：

- `/dev/nvme1n1p3` 的 `pv_used=0`；
- `pvs --segments` 中 M.2 PV 没有任何有效 `lv_name`；
- `lvs -a -o +devices` 中不存在 `nvme1n1p3`；
- 根 LV、swap、thinpool data、thinpool metadata 全部位于 U.2；
- 不存在 `pvmove` 临时 LV；
- guest 仍在运行。

检查：

```bash
findmnt /
swapon --show
dmsetup status pve-data-tpool
qm list
pct list
pvesm status
```

抽查：

```bash
pct status 100
pct status 106
qm status 104
qm status 110
qm status 117
```

保存状态：

```bash
vgcfgbackup -f "$SNAP/vgcfgbackup-pve-after-pvmove" pve
```

此时**不要执行 `vgreduce`**。

---

## Task 4：在 U.2 上建立受 PVE 管理的 GRUB ESP

### Step 4.1：确认当前 PVE 引导管理方式

```bash
proxmox-boot-tool status
cat /etc/kernel/proxmox-boot-uuids 2>/dev/null || true
efibootmgr -v
findmnt /boot/efi
```

#### 判断

当前实际引导项已经确认是：

```text
\EFI\proxmox\shimx64.efi
```

因此新 ESP 使用 GRUB 模式：

```text
proxmox-boot-tool init ... grub
```

即使存在旧的 systemd-boot NVRAM 项，也不在本次迁移中切换 bootloader。

#### 停止条件

如果 `proxmox-boot-tool status` 报告无法识别当前引导布局，或 `init ... grub` 不受支持，停止，不要自行混用 `bootctl` 和不同模式的 `grub-install`。

---

### Step 4.2：格式化并初始化新 ESP

确保新 ESP 未挂载：

```bash
findmnt -S /dev/nvme0n1p1 || true
```

由 Proxmox 工具格式化：

```bash
proxmox-boot-tool format /dev/nvme0n1p1
proxmox-boot-tool init /dev/nvme0n1p1 grub
proxmox-boot-tool refresh
```

检查：

```bash
proxmox-boot-tool status
blkid /dev/nvme0n1p1
cat /etc/kernel/proxmox-boot-uuids
```

#### 验证门槛

- 新 ESP UUID 出现在 `proxmox-boot-tool status`；
- 模式显示为 GRUB；
- 当前内核已同步到新 ESP；
- 命令无错误。

---

### Step 4.3：检查新 ESP 内容

```bash
mkdir -p /mnt/new-esp
mount /dev/nvme0n1p1 /mnt/new-esp

find /mnt/new-esp/EFI -maxdepth 3 -type f -printf '%P\n' | sort
```

必须至少确认：

```text
EFI/proxmox/shimx64.efi
EFI/proxmox/grubx64.efi
```

如果启用了 Secure Boot：

```bash
mokutil --sb-state 2>/dev/null || true
```

必须保留 `shimx64.efi` 引导链，不得把 NVRAM 条目指向未经确认的其他 EFI 文件。

---

### Step 4.4：建立 UEFI removable fallback

建立标准兜底路径：

```bash
mkdir -p /mnt/new-esp/EFI/BOOT

cp -f /mnt/new-esp/EFI/proxmox/shimx64.efi \
  /mnt/new-esp/EFI/BOOT/BOOTX64.EFI

cp -f /mnt/new-esp/EFI/proxmox/grubx64.efi \
  /mnt/new-esp/EFI/BOOT/grubx64.efi

if test -f /mnt/new-esp/EFI/proxmox/mmx64.efi; then
  cp -f /mnt/new-esp/EFI/proxmox/mmx64.efi \
    /mnt/new-esp/EFI/BOOT/mmx64.efi
fi

sync
find /mnt/new-esp/EFI/BOOT -maxdepth 1 -type f -ls
```

#### 说明

UEFI 固件在 NVRAM 条目丢失时通常会尝试：

```text
\EFI\BOOT\BOOTX64.EFI
```

将 `shimx64.efi` 复制为 `BOOTX64.EFI`，并把相邻 `grubx64.efi` 一并复制，才能形成完整 fallback 链。

---

### Step 4.5：更新 `/etc/fstab`

获取旧、新 UUID：

```bash
OLD_ESP_UUID=$(findmnt -no UUID /boot/efi)
NEW_ESP_UUID=$(blkid -s UUID -o value /dev/nvme0n1p1)

printf 'OLD_ESP_UUID=%s\nNEW_ESP_UUID=%s\n' \
  "$OLD_ESP_UUID" "$NEW_ESP_UUID"
```

备份并替换：

```bash
cp -a /etc/fstab /etc/fstab.pre-u2-migration

sed -i \
  "s#^UUID=${OLD_ESP_UUID}[[:space:]]\\+/boot/efi#UUID=${NEW_ESP_UUID} /boot/efi#" \
  /etc/fstab

grep -n '/boot/efi' /etc/fstab
```

切换当前挂载：

```bash
umount /mnt/new-esp
umount /boot/efi
mount /boot/efi

findmnt /boot/efi
blkid /dev/nvme0n1p1
```

#### 验证门槛

`findmnt /boot/efi` 的源必须对应 U.2 新 ESP UUID。

验证全部 fstab：

```bash
mount -a
findmnt --verify --verbose
```

---

### Step 4.6：刷新 initramfs 和 GRUB 配置

```bash
update-initramfs -u -k all
update-grub
proxmox-boot-tool refresh
```

验证 GRUB 配置：

```bash
grep -E \
  'linux.*/boot/vmlinuz|root=/dev/mapper/pve-root|amd_iommu=on|iommu=pt' \
  /boot/grub/grub.cfg |
  head -n 30
```

#### `/boot` 说明

`/boot` 位于 `pve-root` 中完全正常：

- EFI shim/GRUB 从新 ESP 启动；
- GRUB 通过 LVM 模块识别 VG `pve`；
- 从 `pve-root` 中读取 `/boot/grub/grub.cfg` 和内核；
- 内核参数仍使用 `root=/dev/mapper/pve-root`；
- VG/LV 名未变化，因此不需要修改根设备引用。

---

### Step 4.7：创建 U.2 NVRAM 引导项

记录当前顺序：

```bash
efibootmgr -v
CURRENT_ORDER=$(efibootmgr | sed -n 's/^BootOrder: //p')
printf '当前 BootOrder：%s\n' "$CURRENT_ORDER"
```

创建条目：

```bash
efibootmgr \
  --create \
  --disk /dev/nvme0n1 \
  --part 1 \
  --label 'proxmox-u2' \
  --loader '\EFI\proxmox\shimx64.efi'
```

#### 路径说明

单引号保证 shell 不解释反斜杠，实际传递给 UEFI 的路径是：

```text
\EFI\proxmox\shimx64.efi
```

检查：

```bash
efibootmgr -v
```

提取新 Boot ID：

```bash
NEWBOOT=$(
  efibootmgr |
  awk '$0 ~ /proxmox-u2/ {print substr($1,5,4); exit}'
)

printf 'NEWBOOT=%s\n' "$NEWBOOT"
test -n "$NEWBOOT"
```

#### 验证门槛

`efibootmgr -v` 中的新条目必须：

- 指向 U.2 ESP 的 PARTUUID；
- loader 为 `\EFI\proxmox\shimx64.efi`；
- 标签为 `proxmox-u2`。

---

### Step 4.8：仅设置下一次启动项

```bash
efibootmgr --bootnext "$NEWBOOT"
efibootmgr
```

预期：

```text
BootNext: <NEWBOOT>
```

此时不删除旧 M.2 条目，不永久更改 BootOrder。

---

## Task 5：第一次从 U.2 ESP 启动验证

### Step 5.1：重启前最终检查

```bash
findmnt /
findmnt /boot/efi
swapon --show

pvs -o pv_name,vg_name,pv_used,pv_free
lvs -a pve -o lv_name,lv_attr,devices

proxmox-boot-tool status
efibootmgr
pvesm status
qm list
pct list
```

#### 重启前硬门槛

- `/boot/efi` 已挂载 U.2 ESP；
- M.2 PV 的 `pv_used=0`；
- 所有有效 LV 都位于 U.2；
- `BootNext` 是 `proxmox-u2`；
- M.2 仍物理连接；
- 备份可访问。

---

### Step 5.2：执行第一次重启

```bash
reboot
```

通过 IPMI/KVM 观察启动。

如果固件没有遵循 `BootNext`，手工选择 `proxmox-u2`，不要直接继续后续步骤。

---

### Step 5.3：确认启动入口确实是 U.2

重连后：

```bash
efibootmgr
efibootmgr -v

findmnt /
findmnt /boot/efi
lsblk -e7 -o NAME,PATH,SIZE,MODEL,SERIAL,FSTYPE,MOUNTPOINTS

pvs -o pv_name,pv_uuid,vg_name,pv_used,pv_free
lvs -a pve -o lv_name,lv_attr,data_percent,metadata_percent,devices

swapon --show
proxmox-boot-tool status
```

检查 `BootCurrent`：

```bash
BOOT_CURRENT=$(efibootmgr | sed -n 's/^BootCurrent: //p')

printf 'BootCurrent=%s\nNEWBOOT=%s\n' \
  "$BOOT_CURRENT" "$NEWBOOT"
```

#### 硬门槛

必须满足：

```text
BootCurrent == NEWBOOT
```

并且：

- `BootCurrent` 对应 `proxmox-u2`；
- UEFI device path 指向 U.2 ESP PARTUUID；
- `/boot/efi` 是 U.2 ESP；
- `/` 正常挂载；
- root、swap、thinpool 位于 U.2；
- thinpool data/metadata 正常；
- 没有文件系统或 LVM 错误。

如果 `BootCurrent` 仍是旧 M.2 条目，即使系统正常，也不能证明 U.2 ESP 可引导，必须停止。

---

### Step 5.4：验证 PVE 和 guest

```bash
systemctl is-system-running
systemctl --failed

pveversion -v
pvesm status
qm list
pct list

journalctl -b -p warning
dmesg -T | grep -Ei \
  'error|fail|nvme|lvm|thin|I/O|ext4' |
  tail -n 200
```

抽查：

```bash
pct status 100
pct status 103
pct status 106
pct status 115

qm status 104
qm status 105
qm status 110
qm status 117
qm status 121
```

#### 注意事项

`systemctl is-system-running` 可能在迁移前就为 `degraded`。应与 Task 0 基线比较，而不是机械要求必须输出 `running`。

---

### Step 5.5：将 U.2 条目置于永久 BootOrder 首位

重新读取当前顺序：

```bash
CURRENT_ORDER=$(efibootmgr | sed -n 's/^BootOrder: //p')

REST=$(
  printf '%s\n' "$CURRENT_ORDER" |
  tr ',' '\n' |
  grep -vi "^${NEWBOOT}$" |
  paste -sd, -
)

efibootmgr --bootorder "${NEWBOOT}${REST:+,$REST}"
efibootmgr
```

保留旧 M.2 引导项，直到物理移除完成。

---

## Task 6：成功从 U.2 启动后移除 M.2 PV

### Step 6.1：重新根据型号确认设备名

重启后 NVMe 节点名可能改变，先执行：

```bash
lsblk -d -o NAME,PATH,SIZE,MODEL,SERIAL,LOG-SEC,PHY-SEC
nvme list
pvs -o pv_name,pv_uuid,vg_name,pv_used,pv_free
```

不要假定重启后 M.2 仍然叫 `/dev/nvme1n1`。

以下命令中的：

```text
<OLD_M2_PV>
```

必须替换成根据型号、序列号和 PV UUID 确认后的旧 M.2 PV 路径。

在当前已知命名不变时，它应是：

```text
/dev/nvme1n1p3
```

---

### Step 6.2：最终确认旧 PV 无区段

```bash
pvs <OLD_M2_PV> \
  -o pv_name,pv_uuid,vg_name,pv_size,pv_used,pv_free

pvs --segments <OLD_M2_PV> \
  -o pv_name,pvseg_start,pvseg_size,lv_name,segtype

lvs -a pve -o lv_name,lv_attr,devices |
  grep "$(basename "<OLD_M2_PV>")" || true
```

#### 硬门槛

- `pv_used=0`；
- 无 LV 区段；
- 无 `pvmove` 临时 LV；
- root、swap、thinpool 全部在 U.2。

只要存在任何残留区段，不得执行 `vgreduce`。

---

### Step 6.3：从 VG 中移除 M.2 PV

```bash
vgreduce pve <OLD_M2_PV>
```

验证：

```bash
vgs pve \
  -o vg_name,vg_size,vg_free,pv_count,lv_count

pvs \
  -o pv_name,pv_uuid,vg_name,pv_size,pv_used,pv_free

lvs -a pve \
  -o lv_name,lv_attr,lv_size,data_percent,metadata_percent,devices
```

预期：

```text
pve pv_count = 1
```

且唯一 PV 是 U.2 LVM 分区。

#### 注意事项

本方案不执行：

```bash
pvremove -ff <OLD_M2_PV>
```

原因：

- M.2 即将物理移除，没有必要额外破坏盘上标识；
- 减少误操作风险；
- 如果未来复用 M.2，再在目标主机上显式清盘。

保存新元数据：

```bash
vgcfgbackup -f "$SNAP/vgcfgbackup-pve-after-vgreduce" pve
cp -a "$SNAP/vgcfgbackup-pve-after-vgreduce" /mnt/hdd-backups/
sync
```

---

## Task 7：物理移除 M.2

### Step 7.1：关机前检查

```bash
findmnt /
findmnt /boot/efi
swapon --show

pvs -o pv_name,pv_uuid,vg_name,pv_used,pv_free
vgs pve -o vg_name,pv_count,vg_size,vg_free
lvs -a pve -o lv_name,lv_attr,devices

efibootmgr -v
proxmox-boot-tool status
pvesm status
qm list
pct list
```

必须确认：

- `pve` 只有一个 PV；
- 唯一 PV 是 WDC U.2；
- `/boot/efi` 在 U.2；
- 当前启动项是 `proxmox-u2`；
- 没有文件系统、swap、guest passthrough 使用 M.2。

---

### Step 7.2：正常关机

```bash
shutdown -h now
```

等待主机完全断电。

---

### Step 7.3：物理拔除 M.2

拔除：

```text
ZHITAI TiPlus7100 2 TB M.2
```

不要拔错 WDC 7.68 TB U.2 或 HDD。

---

## Task 8：无 M.2 条件下最终启动验证

### Step 8.1：确认硬件和引导

开机后：

```bash
lsblk -e7 -o NAME,PATH,SIZE,MODEL,SERIAL,FSTYPE,MOUNTPOINTS
nvme list

efibootmgr -v
findmnt /
findmnt /boot/efi
swapon --show
```

#### 验证门槛

- 系统中不存在 ZHITAI M.2；
- U.2 正常出现；
- 根文件系统正常；
- ESP 正常挂载；
- swap 正常。

---

### Step 8.2：验证 LVM 和 thinpool

```bash
pvs -o pv_name,pv_uuid,vg_name,pv_size,pv_used,pv_free
vgs -o vg_name,pv_count,lv_count,vg_size,vg_free
lvs -a pve \
  -o lv_name,lv_attr,lv_size,pool_lv,origin,data_percent,metadata_percent,devices

dmsetup status pve-data-tpool
```

必须确认：

- `pve` 只有 U.2 一个 PV；
- 所有 LV 均位于 U.2；
- thinpool data/metadata 正常；
- 无 missing PV、partial VG 或 unknown device。

---

### Step 8.3：验证 PVE 服务、存储和 guest

```bash
systemctl is-system-running
systemctl --failed

pveversion -v
pvesm status
qm list
pct list

journalctl -b -p warning
dmesg -T | grep -Ei \
  'error|fail|nvme|lvm|thin|I/O|ext4' |
  tail -n 200
```

验证关键 guest：

```bash
pct status 100
pct status 103
pct status 106
pct status 115
pct status 116

qm status 104
qm status 105
qm status 110
qm status 111
qm status 112
qm status 113
qm status 117
qm status 120
qm status 121
qm status 122
```

还应从业务侧验证：

- DNS；
- GitLab；
- Kubernetes 控制面和节点；
- 数据库；
- Windows VM；
- GPU passthrough VM；
- 网络转发和 FRP。

---

## Task 9：引导项、storage 和备份收尾

### Step 9.1：清理失效 ESP 记录

物理移除 M.2 后：

```bash
proxmox-boot-tool clean
proxmox-boot-tool refresh
proxmox-boot-tool status
```

再次确认：

```bash
cat /etc/kernel/proxmox-boot-uuids
```

应只保留当前有效 ESP UUID。

---

### Step 9.2：清理旧 M.2 NVRAM 项

列出所有项：

```bash
efibootmgr -v
```

识别指向旧 M.2 ESP PARTUUID：

```text
6f509cda-808f-47f7-9208-145930099c70
```

的 Boot ID，然后删除：

```bash
efibootmgr --delete-bootnum --bootnum <OLD_BOOT_ID>
```

同理，可删除确认无用的旧 systemd-boot 项。

#### 注意事项

不要删除：

- 当前 `BootCurrent`；
- `proxmox-u2`；
- 仍指向 U.2 ESP 的有效项。

最终检查：

```bash
efibootmgr -v
```

---

### Step 9.3：检查 `/etc/fstab` 和 storage 配置

```bash
cat /etc/fstab
findmnt --verify --verbose

cat /etc/pve/storage.cfg
pvesm status
```

#### 预期

- 根仍为 `/dev/pve/root`；
- swap 仍为 `/dev/pve/swap`；
- `/boot/efi` 使用 U.2 ESP UUID；
- `local-lvm` 仍指向 VG `pve` 和 thinpool `data`；
- 不再存在 `u2-ssd` storage；
- HDD storage 保持原样。

由于 VG/LV 名称未变化，`local-lvm` 不需要重建。

---

### Step 9.4：保留备份观察期

建议至少保留一周，并完成一次实际恢复验证。

可选择将一个体积较小的停止模板恢复到临时 VMID，验证备份确实可恢复。

确认稳定后清理：

```bash
umount /mnt/hdd-backups
lvremove -y /dev/hdd-data/migrate-backups
rmdir /mnt/hdd-backups
```

删除前必须再次确认：

- 不再需要这些备份；
- 已有其他长期备份；
- `/mnt/hdd-backups` 确实已卸载；
- 删除的是 `migrate-backups`，不是 HDD thinpool 或 guest LV。

---

## 4. 回滚方案

### 场景 A：U.2 尚未加入 `pve`

如果只完成了 U.2 分区：

```bash
vgremove -y u2-ssd
```

已经不存在时无需处理。M.2 系统不受影响。

---

### 场景 B：`pvmove` 正在执行

先检查：

```bash
pvmove
lvs -a pve -o lv_name,lv_attr,copy_percent,devices
```

必须取消时：

```bash
pvmove --abort
```

取消后重新验证：

```bash
pvs -o pv_name,pv_used,pv_free
lvs -a pve -o lv_name,lv_attr,devices
```

---

### 场景 C：`pvmove` 已完成，但尚未 `vgreduce`

这是最容易回滚的阶段。

可将所有区段反向迁回 M.2：

```bash
pvmove --interval 10 \
  /dev/nvme0n1p2 \
  /dev/nvme1n1p3
```

前提：

- M.2 PV 仍在 `pve` VG 中；
- M.2 有足够空闲区段；
- U.2 上没有迁移后新增、超过 M.2 容量的 LV 分配。

反向迁移后恢复旧 `/etc/fstab`：

```bash
cp -a /etc/fstab.pre-u2-migration /etc/fstab
mount -a
```

并将旧 M.2 引导项设置为 `BootNext`。

---

### 场景 D：第一次从 U.2 启动失败

由于此时 M.2 ESP 和 M.2 PV 尚未执行 `vgreduce`：

1. 进入 UEFI Boot Manager；
2. 选择旧 M.2 上的 `proxmox` 条目；
3. 旧 M.2 ESP 中的 GRUB 应能发现仍属于 `pve` VG 的 U.2，并启动其上的 `pve-root`；
4. 修复新 ESP 或反向执行 `pvmove`。

注意：这不是从 M.2 上的旧根文件系统启动，根 LV 已经迁到 U.2。

---

### 场景 E：已执行 `vgreduce`，但尚未拔 M.2

不要直接尝试“反向 `pvmove`”，因为 M.2 已经不属于 VG。

如果确实必须重新加入，需先根据保存的 LVM 元数据和当前 PV 状态制定专门恢复步骤。此时禁止盲目执行：

```bash
pvcreate
vgextend
```

这些命令可能覆盖原 PV 标识。优先从 U.2 正常运行，修复引导问题。

---

### 场景 F：拔除 M.2 后无法引导

按以下顺序处理：

1. 进入 UEFI，选择 `proxmox-u2`；
2. 如果 NVRAM 条目丢失，尝试 UEFI 默认磁盘引导；
3. 默认引导应读取：

   ```text
   \EFI\BOOT\BOOTX64.EFI
   ```

4. 如果仍失败，使用 PVE/Debian 安装介质进入 rescue 环境；
5. 激活 VG：

   ```bash
   vgchange -ay pve
   ```

6. 挂载根 LV 和 ESP；
7. 使用 `proxmox-boot-tool init <ESP> grub` 重建引导。

---

### 场景 G：guest 或 thinpool 损坏

优先停止进一步写入，检查：

```bash
lvs -a pve \
  -o lv_name,lv_attr,data_percent,metadata_percent,devices
dmsetup status pve-data-tpool
journalctl -k
```

不要直接运行 `lvconvert --repair`。先保存当前 LVM metadata，并根据具体错误制定恢复操作。

最后恢复来源为：

```text
/mnt/hdd-backups/vzdump-*
```

但 HDD 上原本 guest 的同盘备份不能防御 HDD 本身损坏。

---

## 5. 最终验收标准

迁移只有同时满足以下条件才算完成：

- 已成功生成并校验所有 guest 的 `vzdump`；
- U.2 采用 GPT，包含 FAT32 ESP 和 LVM PV；
- U.2 分区通过 optimal alignment 检查；
- `pve` VG 只有一个 PV，且该 PV 位于 WDC U.2；
- `pve-root`、swap、thinpool data、thinpool metadata、快照和模板基全部位于 U.2；
- `BootCurrent` 指向 U.2 ESP；
- `/boot/efi` 挂载 U.2 ESP；
- `\EFI\proxmox\shimx64.efi` 存在；
- `\EFI\BOOT\BOOTX64.EFI` fallback 存在；
- `/boot/grub/grub.cfg` 保留：
  - `root=/dev/mapper/pve-root`；
  - `amd_iommu=on`；
  - `iommu=pt`；
- M.2 已物理移除；
- 无 missing PV、partial VG、thinpool 错误或 NVMe I/O 错误；
- PVE storage 全部 online；
- 所有原运行 guest 恢复到原状态；
- 关键业务通过实际访问验证。
