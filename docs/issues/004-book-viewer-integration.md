# Issues / 追加機能メモ

---

## #4 book-viewer との連携 — viewer_id があれば外部ビューアーで開く

**概要**
外部の book-viewer アプリ（`https://chokotia.github.io/book-viewer/?book={id}&page={num}`）に対応するため、
JSON の `metadata` に任意フィールド `viewer_id` を追加する。
検索結果カードをクリックした際、`viewer_id` が設定されている本は外部ビューアーで開き、
設定されていない本は従来どおり Blob 別タブで開く。

---

**背景**

book-viewer は本の ID とページ番号をクエリパラメータで受け取り、該当ページを直接表示できる外部アプリ。
すべての本が viewer に登録されているわけではないため、本ごとに「viewer で開けるか否か」を制御する必要がある。

「毎回自動判定」や「別途設定画面」は複雑になるため、
**JSON の `metadata.viewer_id` の有無をフラグとして使う**設計にする。
JSON ファイルに `viewer_id` を書けばそのままビューアー連携が有効になる。

---

**要件**

1. **`metadata.viewer_id` の追加（省略可能）**
   - `viewer_id` がある本はカードクリック時に外部 book-viewer で開く
   - `viewer_id` がない本は従来どおり Blob 別タブを開く（後方互換）

2. **外部ビューアーの URL 形式**
   ```
   https://chokotia.github.io/book-viewer/?book={viewer_id}&page={pageNum}
   ```

---

**実装方針**

### 1. `sample_input.json` — スキーマ変更

`metadata` に任意フィールド `viewer_id` を追加する。

```json
{
  "metadata": {
    "title": "...",
    "viewer_id": "book1",
    "total_pages": 439,
    "created_at": "2026-02-18T16:08:12"
  }
}
```

### 2. `app.js` — `loadBookFromFile()` で `viewer_id` を保存

`meta` オブジェクト組み立て部分（約 L129）に `viewer_id` を追加する。

```js
const meta = {
  title:       data.metadata.title,
  viewer_id:   data.metadata.viewer_id   ?? null,   // 追加
  total_pages: data.metadata.total_pages ?? null,
  created_at:  data.metadata.created_at  ?? null,
  savedAt:     new Date().toISOString(),
};
```

### 3. `app.js` — `openPageViewer()` に振り分けロジックを追加

```js
const VIEWER_BASE_URL = 'https://chokotia.github.io/book-viewer/';

function openPageViewer(bookId, pageNum) {
  const meta  = getBookMeta(bookId);
  const pages = getBookPages(bookId);
  const page  = pages.find((p) => p.page === pageNum);

  if (!meta || !page) {
    showError('ページデータが見つかりません。');
    return;
  }

  // viewer_id があれば外部ビューアーを開く
  if (meta.viewer_id) {
    const url = `${VIEWER_BASE_URL}?book=${encodeURIComponent(meta.viewer_id)}&page=${pageNum}`;
    window.open(url, '_blank');
    return;
  }

  // viewer_id がなければ従来どおり Blob を開く
  const tocIndex   = buildTocIndex(getBookToc(bookId));
  const breadcrumb = findBreadcrumb(tocIndex, pageNum);
  const html = buildPageViewerHTML(meta, pageNum, page.content, breadcrumb);
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  window.open(url, '_blank');
}
```

---

**影響範囲**

| ファイル | 変更内容 |
|---|---|
| `sample_input.json` | `metadata.viewer_id` フィールドを追加（省略可能） |
| `app.js` | `loadBookFromFile()` で `viewer_id` を保存、`openPageViewer()` で振り分けロジックを追加 |
