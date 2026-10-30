# Google AI Studio Clean Copy Markdown

[中文说明](README.zh-CN.md)

Tampermonkey userscript for [Google AI Studio](https://aistudio.google.com/). One click copies a **complete model reply as Markdown**: body, inline citations, and the Sources list. Redirect wrappers are unwrapped to the real URLs.

Official **Copy as markdown** drops citation URLs and the Sources block. This script keeps both, then cleans the links.

## What you get

A green `markdown_copy` button on each model-reply toolbar.

Copied Markdown includes:

- Headings, lists, quotes, bold/italic, inline code, fenced code blocks
- Inline citations in Raw-style form: `[[1](https://real-source.example/page)]`
- A trailing **Sources** section with titles and cleaned URLs

It does **not** switch Raw Mode, so the page does not flicker.

## Why the official copy is not enough

1. **Incomplete copy** — AI Studio’s Copy as markdown keeps formatting but strips grounding citations. Sources at the bottom are omitted.
2. **Wrapped URLs** — remaining links are usually:
   - `https://www.google.com/url?sa=E&q=...`
   - `https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQ...`

The first kind stores the target in `q` / `url`. The second is an encrypted token; the real address is only in the HTTP `302 Location` header.

## Link cleaning

Redirect unwrapping matches the `vertexaisearch-jiexi` resolver:

| Kind | Method |
|---|---|
| `google.com/url?q=` (and `google.co.jp` etc.) | Unwrap locally from `q` / `url`, including nested wrappers |
| `vertexaisearch.../grounding-api-redirect/` | `HEAD`/`GET`, read `Location` only, do not require the destination page body |
| Tracking | Strip `utm_*`, `gclid`, `fbclid`, `spm`, … |

Resolved URLs are cached in the userscript store (24h).

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open the script: [aistudio-clean-copy.user.js](https://raw.githubusercontent.com/magiccodelab/aistudio-clean-copy/main/aistudio-clean-copy.user.js)
3. Confirm install. On first copy, allow cross-origin access to `vertexaisearch.cloud.google.com` (choose **Always allow** if asked).

## Usage

1. Open a prompt at `https://aistudio.google.com/prompts/...`.
2. Hover a **model** reply.
3. Click the green Markdown icon.
4. Toast: **Copying…** → **Copied**. Paste anywhere.

User turns are left unchanged. Thoughts / search chips are not copied.

## Permissions

| Grant | Why |
|---|---|
| `GM_xmlhttpRequest` | Resolve Vertex grounding redirects (CORS) |
| `GM_setClipboard` | Write Markdown to the clipboard |
| `GM_setValue` / `GM_getValue` | URL cache |
| `GM_addStyle` | Button + toast |
| `@connect *` | First hop is Vertex; `Location` may point at any host if the manager follows redirects |

The script only runs on prompt pages:

- `https://aistudio.google.com/prompts/*`
- `https://aistudio.google.com/u/*/prompts/*` (multi-account)

It does not inject on Library, Apps, Docs, or API key pages.

## License

[MIT](LICENSE)

## Contributing

Issues and PRs: https://github.com/magiccodelab/aistudio-clean-copy/issues
