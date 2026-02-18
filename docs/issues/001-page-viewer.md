# Issues / 追加機能メモ

---

## #1 検索結果カードクリックでページ全文を別タブ表示 ✅

**概要**
検索結果カードをクリックすると、そのページの本文を別タブで読みやすく表示する。

**要件**
- 右端で折り返す（横スクロールしない）
- 改行はそのまま改行として表示
- 文字サイズ・行間など最低限人が読みやすい体裁にする

**実装**
- 修正: `app.js`
  - `buildPageViewerHTML(meta, pageNum, content)` — HTML を文字列で組み立て（CSS インライン、XSS対策済み）
  - `openPageViewer(bookId, pageNum)` — Blob URL を生成して `window.open` で別タブ表示
  - `renderResults` でカードに `onclick="openPageViewer(...)"` を付与
  - `white-space: pre-wrap` + `word-break: break-word` で折り返し・改行保持
  - 最大幅 800px 中央寄せ、フォントサイズ 1.05rem、行間 1.85
- 修正: `style.css` — `.result-card` に `cursor: pointer` とホバー時の枠線変化を追加

**備考**
当初 `page-viewer.html` + URL パラメータ方式で実装したが、`file://` プロトコルでは
`location.search` / `location.hash` がブラウザによって空になる問題が発生。
Blob URL 方式（`URL.createObjectURL`）に変更することで解決。
`page-viewer.html` は不要になったため削除。
