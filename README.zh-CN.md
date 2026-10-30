# Google AI Studio 完整复制 Markdown

[English](README.md)

面向 [Google AI Studio](https://aistudio.google.com/) 的油猴脚本。一键把**整条模型回复**复制为 Markdown：正文、文内引用、底部 Sources。Google 套的重定向链接会还原成真实网址。

官方 **Copy as markdown** 会丢掉引用 URL 和 Sources。本脚本两样都保留，再清洗链接。

## 复制结果

每条模型回复的工具栏会多一个绿色 `markdown_copy` 按钮。

剪贴板里是完整 Markdown，包括：

- 标题、列表、引用块、加粗/斜体、行内代码、围栏代码块
- 文内引用，格式与 Raw Mode 一致：`[[1](https://真实来源/页面)]`
- 文末 **Sources** 列表（标题 + 净化后的 URL）

复制时**不会**切换 Raw Mode，页面不会闪烁。

## 官方复制缺什么

1. **不完整** — 官方 Copy as markdown 能保住排版，但会剥掉联网搜索（Grounding）的引用链接，底部 Sources 也不会带上。
2. **链接被包裹** — 剩下的地址通常是：
   - `https://www.google.com/url?sa=E&q=...`
   - `https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQ...`

第一种能从 `q` / `url` 参数本地解开。第二种是服务端加密 Token，真实网址只出现在 HTTP `302 Location` 响应头里。

## 链接怎么洗

还原逻辑对齐 `vertexaisearch-jiexi`：

| 类型 | 做法 |
|---|---|
| `google.com/url?q=`（含 `google.co.jp` 等） | 本地从 `q` / `url` 取出目标，支持多层嵌套 |
| `vertexaisearch.../grounding-api-redirect/` | `HEAD`/`GET`，只读 `Location`，不拉目标站正文 |
| 跟踪参数 | 去掉 `utm_*`、`gclid`、`fbclid`、`spm` 等 |

解析结果缓存在油猴存储里（24 小时）。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey）。
2. 打开脚本：[aistudio-clean-copy.user.js](https://raw.githubusercontent.com/magiccodelab/aistudio-clean-copy/main/aistudio-clean-copy.user.js)
3. 确认安装。第一次复制时，若弹出跨域权限，请允许访问 `vertexaisearch.cloud.google.com`（选 **始终允许**）。

也可把本仓库的 `.user.js` 全文粘进油猴「添加新脚本」。

## 用法

1. 打开 `aistudio.google.com` 里的对话。
2. 悬停在**模型回复**上。
3. 点绿色 Markdown 图标。
4. 右下角提示：**正在复制…** → **已复制**。直接粘贴即可。

用户发言不会加按钮。思考过程、相关搜索条不会进剪贴板。

## 权限

| 权限 | 用途 |
|---|---|
| `GM_xmlhttpRequest` | 跨域解析 Vertex Grounding 重定向 |
| `GM_setClipboard` | 写入 Markdown |
| `GM_setValue` / `GM_getValue` | URL 缓存 |
| `GM_addStyle` | 按钮和提示 |
| `@connect *` | 第一跳是 Vertex；若管理器跟随跳转，`Location` 可能指向任意站点 |

脚本只匹配 `https://aistudio.google.com/*`。

## 许可证

[MIT](LICENSE)

## 反馈

Issue / PR：https://github.com/magiccodelab/aistudio-clean-copy/issues
