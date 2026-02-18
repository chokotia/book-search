# Book Search System - Implementation Plan

## 目次

1. [概要](#1-概要)
2. [設計](#2-設計)
3. [実装ステップ](#3-実装ステップ)
4. [動作確認](#4-動作確認)

---

## 1. 概要

GitHub Pages で動作するシンプルな本の全文検索システムを構築する。
書籍コンテンツは著作権保護のためサーバに置かず、ユーザがローカルの JSON ファイルを読み込む形式とする。
一度読み込んだ本は localStorage に保存し、次回以降はファイル選択不要で再利用できる。

**確認済み仕様:**
- 複数キーワード検索: AND 検索（スペース区切り）
- 削除機能: あり（本リストから個別に削除可能）
- UI スタイル: モダン・カード型
- 同タイトルの本を重複読み込みした場合: エラー表示して弾く（タイトルは `trim()` + `toLowerCase()` + `normalize('NFKC')` 後に比較）
- 選択中の本を削除した場合: 空の状態に戻し「本を選択してください」と表示
- 削除時は `window.confirm()` で確認ダイアログを表示してから削除する
- 本未選択時は検索ボックスを `disabled` にして入力不可にする
- 検索結果は全件表示（上限なし）、ページ番号昇順で表示する
- 検索・タイトル比較時に `normalize('NFKC')` で全角・半角を正規化する（例: 「ＡＩ」と「AI」をマッチさせる）
- ページロード時に前回選択していた本を自動復元する（`booksearch_selected` に保存した ID で復元）
- 本切り替え時は検索ボックスの内容をクリアする
- 0冊時のサイドバーには「まだ本がありません」と表示する
- エラー表示はサイドバー上部に一時バナーで行い、3秒後に自動消去する（バリデーションエラー・容量オーバー・JSON パースエラー共通）
- ファイル読み込みのローディング表示は不要（FileReader はUIをブロックしないため）

### ファイル構成

```
book-search/
├── index.html       # メインアプリ（単一ページ）
├── style.css        # スタイル（外部依存なし）
├── app.js           # アプリロジック
└── README.md        # 更新済みドキュメント
```

外部ライブラリは一切使用しない（GitHub Pages で追加設定不要）。

---

## 2. 設計

### 2.1 UI レイアウト

```
┌─────────────────────────────────────────────┐
│  📚 本の検索システム                         │
├──────────────┬──────────────────────────────┤
│  [+ 本を追加] │  🔍 [検索ボックス           ] │
│              │                              │
│  ── ライブラリ ──  │  検索結果 (n件)             │
│  ◉ Book A [🗑] │  ┌──────────────────────┐  │
│  ○ Book B [🗑] │  │ p.12  ...キーワード... │  │
│  ○ Book C [🗑] │  │ 本文抜粋（ハイライト）  │  │
│              │  └──────────────────────┘  │
│              │  ┌──────────────────────┐  │
│              │  │ p.34  ...キーワード... │  │
│              │  └──────────────────────┘  │
└──────────────┴──────────────────────────────┘
```

### 2.2 データ設計

#### LocalStorage スキーマ

```
booksearch_index            → JSON配列 [ "id1", "id2", ... ]
booksearch_meta_{id}        → { title, total_pages, created_at, savedAt }
booksearch_pages_{id}       → [ { page, content }, ... ]
booksearch_selected         → 選択中の本のID（文字列）
```

- Book ID: `crypto.randomUUID()` で生成
- 容量目安: 1冊 ≒ 300KB、5MB制限内で約15冊程度まで対応
- 容量オーバー時はエラーメッセージを日本語で表示

#### 入力 JSON フォーマット

アプリが受け付ける JSON の構造は以下の通り。

```json
{
  "metadata": {
    "title": "本のタイトル",
    "total_pages": 134,
    "created_at": "2026-02-18T14:06:30"
  },
  "pages": [
    {
      "page": 2,
      "filename": "002.txt",
      "content": "ページの本文テキスト..."
    },
    {
      "page": 3,
      "filename": "003.txt",
      "content": "ページの本文テキスト..."
    }
  ]
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `metadata.title` | string | ✅ | 本のタイトル（ライブラリ一覧に表示） |
| `metadata.total_pages` | number | - | 総ページ数（表示用） |
| `metadata.created_at` | string | - | 作成日時（ISO 8601） |
| `pages` | array | ✅ | ページ情報の配列 |
| `pages[].page` | number | ✅ | ページ番号（検索結果に表示） |
| `pages[].filename` | string | - | 元ファイル名（アプリでは使用しない） |
| `pages[].content` | string | ✅ | 検索対象となる本文テキスト |

**注意:**
- `pages` の順序は `page` 番号順でなくてもよい（検索時にソートする）
- `pages[].filename` はアプリ内では参照しない

#### JSON バリデーション

読み込み時に以下を確認し、不正なファイルはエラー表示:
- `metadata.title` が存在する
- `pages` が配列である
- `pages.length > 0` である（空配列を弾く）
- `pages[0].content` が文字列である

### 2.3 ロジック設計

#### app.js 主要関数

| 関数 | 役割 |
|------|------|
| `loadBookFromFile(file)` | JSON読み込み → バリデーション → localStorage保存 |
| `getBookIndex()` | localStorage からID一覧取得 |
| `getBookMeta(id)` | メタデータ取得 |
| `getBookPages(id)` | ページコンテンツ取得 |
| `selectBook(id)` | 選択本をメモリに展開、UI更新 |
| `search(query)` | スペース分割→AND検索→マッチページ返却 |
| `extractExcerpt(content, terms)` | 全キーワードの中で最も先頭に出てくるマッチ位置を基準に前後 ±150字を抜粋 |
| `highlightText(text, terms)` | content をHTMLエスケープ後、正規化テキスト上で indexOf によりマッチ位置を特定し、元テキストの同位置に `<mark>` タグを挿入（全マッチ箇所・XSS対策済み） |
| `renderBookList()` | サイドバーの本一覧を再描画 |
| `deleteBook(id)` | `window.confirm()` で確認後、localStorage から本を削除、UI更新 |
| `renderResults(results, terms)` | カード型検索結果を描画 |

#### 検索ロジック

```js
function normalize(str) {
  return str.normalize('NFKC').toLowerCase();
}

function search(query, pages) {
  // 検索クエリを正規化して検索単語リストに変換
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);

  if (terms.length === 0) return [];

  // 全ページの中から「全ての検索ワードが含まれるページ」だけを返す（AND検索）
  // ページ番号昇順にソートして返す
  return pages
    .filter(p => terms.every(term => normalize(p.content).includes(term)))
    .sort((a, b) => a.page - b.page);
}
```

- リアルタイム検索（300ms デバウンス）
- マッチ件数をヘッダに表示
- 0件時は「該当ページが見つかりませんでした」と表示
- 結果は全件表示（上限なし）

---

## 3. 実装ステップ

1. `index.html` - HTML骨格（ヘッダ・サイドバー・メインエリア）
2. `style.css` - CSS変数・レイアウト・カードスタイル・ハイライト
3. `app.js` - localStorage操作 → ファイル読み込み → 検索 → 描画
4. `README.md` - 使い方を日本語で記載

---

## 4. 動作確認

1. リポジトリを `git push` → GitHub Pages（`main`ブランチ直下）で公開確認
2. ローカルでも `index.html` をブラウザで直接開いて動作確認可能（`file://`）
3. サンプル JSON を読み込み → 本が一覧に表示されることを確認
4. キーワード検索 → AND条件でフィルタされることを確認
5. ページリロード後も本が残っていることを確認（localStorage永続化）
6. 別の本を追加 → 切り替えて検索できることを確認
7. 削除ボタンを押す → 確認ダイアログ後に本が一覧から消えることを確認
