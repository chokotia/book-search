# Issues / 追加機能メモ

---

## #3 ページビューアー別タブで目次パンくずが表示されない

**概要**
検索結果カードには目次のパンくずが表示されているが、カードをクリックして開く別タブのページビューアーには目次情報が表示されない。
JSON に `table_of_contents` が存在する場合は、ページビューアーにも対象ページのパンくずを表示する。

---

**背景**

#2 の実装により、検索結果カードには以下のようなパンくずが表示されるようになった。

```
第1部：サービス別対策 > 第1章 コンピューティング > 1.1 Amazon Elastic Compute Cloud (Amazon EC2)
```

しかし、カードをクリックして別タブで開くページビューアーには、この情報が引き継がれておらず、本のタイトルとページ番号しか表示されない。

---

**要件**

1. **パンくずの表示**
   - `table_of_contents` が存在する本のページビューアーには、対象ページのパンくずをヘッダー部分に表示する
   - `table_of_contents` が存在しない本（旧フォーマット）は表示しない（後方互換）

2. **表示位置・スタイル**
   - 本のタイトルとページ番号の間など、ヘッダー内に自然に収まる位置に配置する
   - 検索結果カードのパンくず表示と概ね同等のスタイルにする

---

**原因**

`openPageViewer`（`app.js` L443）が `buildPageViewerHTML` を呼ぶ際に TOC 情報を渡していない。
`buildPageViewerHTML`（`app.js` L376）はページ本文（`content`）のみを受け取る設計になっており、パンくずを出力できない。

---

**実装方針**

### 1. `openPageViewer` の修正（`app.js`）

- `getBookToc(bookId)` で TOC を取得し、`buildTocIndex` でインデックスを構築する
- `findBreadcrumb(tocIndex, pageNum)` でパンくず文字列を取得する
- `buildPageViewerHTML` にパンくズを追加引数として渡す

### 2. `buildPageViewerHTML` の修正（`app.js`）

- 引数に `breadcrumb`（文字列配列 or null）を追加する
- `breadcrumb` が存在する場合、ヘッダー内に `<div class="page-breadcrumb">` を出力する
- `breadcrumb` が `null` の場合は要素を省略する

### 3. スタイルの追加（インライン CSS）

- `buildPageViewerHTML` 内のインライン `<style>` に `.page-breadcrumb` のスタイルを追加する
  - 小さめフォント、サブテキスト色（例 `#64748b`）

---

**影響範囲**

| ファイル | 変更内容 |
|---|---|
| `app.js` | `openPageViewer` で TOC からパンくずを取得して `buildPageViewerHTML` に渡す、`buildPageViewerHTML` でパンくず表示を追加 |
