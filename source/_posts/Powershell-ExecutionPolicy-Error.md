---
title: Powershell ExecutionPolicy Error
date: 2020-02-05 16:42:14
tags:
---


vscode打开调试模式，调试Python报错
```powershell
...cannot be loaded because running scripts is disabled on 
this system. For more information, see about_Execution_Policies at...
```

powershell的默认执行策略是受限的，所以要更改powershell的执行策略，才能执行这些脚本
使用命令行身份打开powershell，执行以下命令
```powershell
# 查看ExecutionPolicy状态
Get-ExecutionPolicy

# 设置ExecutionPolicy
Set-ExecutionPolicy unrestricted
```
然后输入a，也就是all的那个选项，确认即可。