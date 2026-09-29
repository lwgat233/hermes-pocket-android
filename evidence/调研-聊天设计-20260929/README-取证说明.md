# 证据 · 聊天产品设计调研（2026-09-29）

**用途**：支撑 `docs/调研-聊天设计-20260929.md`（`R-52` 发送状态 / `R-53` 删除历史）。
**红线遵守**：**只读公开页面**、**没 clone 任何仓库**、**没读任何 AGPL 源码**、**没改代码**。
**抓取方式**：`curl` 走本机代理 `127.0.0.1:7890` + 桌面 UA（抓取脚本 `/vol1/1000/aicache/tmp/fetch-chat-design.sh`，抽取脚本 `extract-chat-design.py`）。

## 抓取读数（脚本原始输出）

| 出处 | URL | http | 字节 | 结果 |
|---|---|---|---|---|
| Telegram 官方 FAQ | `https://telegram.org/faq` | 200 | 119829 | ✅ 有原文（对号含义、删除双边、无痕） |
| Signal 支持页（送达/已读） | `support.signal.org/hc/en-us/articles/360007320751` | **403** | 5969 | ❌ Cloudflare 挡下（浏览器打开也停在校验页）⇒ 结论里只能引搜索引擎回传的**该页原文摘要**，并标"未逐字核" |
| Signal 支持页（Delete for everyone） | `support.signal.org/hc/en-us/articles/360050426432` | **403** | 5836 | ❌ 同上 |
| Signal 支持页（删除消息/提醒/聊天） | `support.signal.org/hc/en-us/articles/360007320491` | **403** | 5894 | ❌ 同上 |
| 企业微信帮助（撤回规则） | `open.work.weixin.qq.com/help2/pc/14923` | 200 | 1005490 | ✅ 有原文（内部 24h / 微信联系人 2min / 已删除不能撤回） |
| 新华网转载"微信时刻"（撤回新变化） | `app.xinhuanet.com/news/article.html?articleId=20260808fe…` | 200 | 22477 | ✅ 有原文（撤回提示可删、撤回本次全部、文件 3 小时） |
| QQ 机器人开发者文档（撤回消息接口） | `bot.q.qq.com/wiki/develop/pythonsdk/api/message/recall_message.html` | 200 | 29183 | ✅ 但**这是机器人接口，不是客户端行为**，只能当旁证 |
| Telegram 对号解释（第三方） | `techmesto.com/telegram-checkmarks/` | 200 | 212190 | ✅ 时钟=待发/单勾=已发/双勾=已读 |
| Telegram 删除规则（第三方） | `howtogeek.com/710375/…` | 200 | 275859 | ✅ 单聊无时限双边删、群 48h 限 |
| 微信删除 vs 撤回（第三方） | `shujuwa.net/weixin/how-to-recover-wechat-records` | — | — | ⚠️ 第三方教程站，只作"公开可见行为"旁证，**不当官方依据** |

- `摘录-原文.txt`：上面各页里按关键词（check mark / delete / 撤回 / 感叹号 / 已读 / 24 hours …）抽出的原句（命中行数：telegram-faq 60 · wecom 40 · howtogeek 21 · xinhua 17 · techmesto 9 · qqbot 8）。
- `qq-red-bang`（红叹号）本轮**没单独抓页**：结论里引的是腾讯云开发者社区报道 + 其中**引用的腾讯 QQ 官方公告原文**（"部分用户发送 QQ 消息之后，出现红色感叹号，而消息实际上是发送成功的"）。

## 没查到的（照实记）

1. **微信官方帮助页**关于"删除聊天记录是否只影响本端"——**没找到官方条目**（只有第三方教程与我方公开可见行为的印象）⇒ 文档里标"未查证"。
2. **QQ 客户端撤回时限（2 分钟）的官方帮助页**——本轮没找到（只找到机器人接口文档）⇒ 标"未查证"。
3. **微信成功态不打勾**这句——官方文档里没有描述，属公开可见行为。
4. Signal 两篇支持页的逐字原文——被 Cloudflare 挡住，**未逐字核**。
