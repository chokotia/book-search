# Issues / 追加機能メモ

---

## #2 検索結果カードに目次パンくず（章・節の階層）を表示

**概要**
入力 JSON に `table_of_contents`（目次）フィールドが追加された。
検索結果カードに、ヒットしたページがどの部・章・節に属するかを階層形式で表示する。

---

**背景**
現状の検索結果カードは `p.16` のようなページ番号のみを表示している。
目次データを活用することで、例えば

```
第1部：サービス別対策 > 第1章 コンピューティング > 1.1 Amazon Elastic Compute Cloud (Amazon EC2)
```

のような位置情報（パンくず）をカードに添えられる。
これにより、ヒットしたページが本全体のどこに位置するかが一目でわかる。

---

**要件**

1. **ページ → 目次エントリのマッピング**
   - ヒットしたページ番号に対し、`table_of_contents` を走査して「そのページが属する最も深い節（item）」を特定する
   - 判定ルール：あるエントリの `page <= ヒットページ < 次エントリの page` であれば、そのエントリに属する
   - 節が見つかった場合は、その親（章 → 部）まで遡って全階層を収集する

2. **パンくずの表示**
   - 見つかった階層を `>` でつないでカード内に表示する
   - 例： `第1部：サービス別対策 > 第1章 コンピューティング > 1.1 Amazon EC2`
   - 目次データがない場合（旧フォーマットの本）はパンくずを表示しない（後方互換）

3. **データの保存**
   - 本をロードする際、`table_of_contents` が存在すれば LocalStorage に保存する
   - キー例： `booksearch_toc_<id>`

---

**実装方針**

### 1. `loadBookFromFile` の修正（`app.js`）

- `data.table_of_contents` が存在する場合、LocalStorage に保存する
  ```
  localStorage.setItem(LS_TOC(id), JSON.stringify(data.table_of_contents));
  ```
- `LS_TOC` キーを他の `LS_*` と同様に定義する

### 2. TOC ヘルパー関数の追加（`app.js`）

- `getBookToc(id)` — LocalStorage から目次を取得する
- `buildTocIndex(toc)` — 目次を走査し、各末端 item とその親チェーン（部・章）を含む
  フラットなリスト `[{ page, breadcrumb: ['部タイトル', '章タイトル', '節タイトル'] }, ...]`
  としてキャッシュする（ページ昇順でソート済み）
- `findBreadcrumb(tocIndex, pageNum)` — 二分探索または線形スキャンで
  `entry.page <= pageNum < nextEntry.page` となるエントリを返す

### 3. `renderResults` の修正（`app.js`）

- 検索結果カードの HTML に `<div class="result-breadcrumb">...</div>` を追加する
- `findBreadcrumb` が `null` を返した場合（目次なし・範囲外）はその要素を省略する

### 4. スタイルの追加（`style.css`）

- `.result-breadcrumb` のスタイルを追加する
  - 小さめフォント（例 `0.75rem`）、ページ番号より上または下に配置
  - 色はサブテキスト色（例 `#64748b`）
  - `>` 区切りはテキストか CSS の `::before` で実現

---

**考慮事項**

- 目次の `items` が再帰的にネストしている（部 > 章 > 節）ため、走査は再帰または
  スタックを使って汎用的に実装する
- 末端 item の `page` は「その節の開始ページ」であり、「終了ページ」は次の item の
  `page - 1` と見なす
- 同じ `page` 値を持つ複数エントリが存在しうる場合は、最後にマッチしたエントリを優先する
  （章扉より節の方が詳しい情報）
- `table_of_contents` がない旧フォーマットの本は既存動作のまま（パンくず非表示）

---

**影響範囲**

| ファイル | 変更内容 |
|---|---|
| `app.js` | `LS_TOC` 定数追加、`getBookToc` / `buildTocIndex` / `findBreadcrumb` 追加、`loadBookFromFile` で TOC 保存、`renderResults` でパンくず表示 |
| `style.css` | `.result-breadcrumb` スタイル追加 |
