# pi-pause

Gracefully pause Pi at safe execution boundaries without disrupting the KV cache.

**零上下文注入，无额外工具注入。**

`/pause` 等当前响应和整批工具完成后暂停；发送下一条普通消息继续。

不改写历史前缀。缓存保留时间取决于服务商；需要立即中断时用 Esc。

[安装](docs/development.md#setup)后重启 Pi，`/reload` 不够。
