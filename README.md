# 本の検索システム

GitHub Pages で動作する、本の全文検索システムです。外部ライブラリは一切使用していません。

## 特徴

- **ローカルファイル読み込み** — 書籍データはサーバに置かず、ユーザが JSON ファイルを手元から読み込む形式（著作権保護）
- **localStorage 保存** — 一度読み込んだ本はブラウザを閉じても保持。次回以降はファイル選択不要
- **AND 検索** — スペース区切りで複数キーワードを指定すると、すべてを含むページのみ表示（全件・上限なし）
- **全角・半角対応** — NFKC 正規化により「ＡＩ」と「AI」などを同一視
- **前回選択を自動復元** — ページリロード後も選択中の本が引き継がれる
- **外部ビューアー連携** — JSON に `viewer_id` を設定すると、カードクリック時に外部 book-viewer で該当ページを開く
- **外部依存なし** — 純粋な HTML / CSS / JavaScript のみ（GitHub Pages でそのまま公開可能）

---

## 使い方

### 1. 本を追加する

1. 「+ 本を追加」ボタンをクリック
2. 対応フォーマット（下記参照）の JSON ファイルを選択
3. サイドバーに本のタイトルが追加される

同じタイトルの本を二重に読み込もうとするとエラーが表示されます。

### 2. 本を選択する

サイドバーの本のタイトルをクリックすると、その本が検索対象になります。

### 3. 検索する

検索ボックスにキーワードを入力すると、300ms のデバウンス後にリアルタイムで検索結果が表示されます。

- スペース区切りで複数キーワード → AND 検索
- 結果はページ番号昇順で全件表示
- 本が未選択の状態では検索ボックスは無効化されます

### 4. 本を削除する

サイドバーの 🗑 ボタンをクリック → 確認ダイアログ → 削除。
選択中の本を削除した場合は空の状態に戻ります。

---

## 入力 JSON フォーマット

```json
{
  "metadata": {
    "title": "本のタイトル",
    "viewer_id": "book-id",
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
| `metadata.viewer_id` | string | — | 外部ビューアーの本 ID（設定すると book-viewer で開く、任意） |
| `metadata.total_pages` | number | — | 総ページ数（任意） |
| `metadata.created_at` | string | — | 作成日時（ISO 8601、任意） |
| `pages` | array | ✅ | ページ情報の配列 |
| `pages[].page` | number | ✅ | ページ番号（検索結果に表示） |
| `pages[].filename` | string | — | 元ファイル名（アプリ内では不使用） |
| `pages[].content` | string | ✅ | 検索対象の本文テキスト |

`pages` の順序は任意です。検索時にページ番号昇順でソートされます。

---

## 技術仕様

### localStorage スキーマ

| キー | 内容 |
|---|---|
| `booksearch_index` | 本 ID の配列 (`string[]`) |
| `booksearch_meta_{id}` | タイトル・viewer_id・総ページ数・作成日時・保存日時 |
| `booksearch_pages_{id}` | `{ page, content }` の配列 |
| `booksearch_selected` | 選択中の本の ID |

- 本 ID は `crypto.randomUUID()` で生成
- 容量目安: 1冊 ≒ 300 KB、ブラウザの localStorage 上限（≒5 MB）で約 15 冊程度まで対応

### ファイル構成

```
book-search/
├── index.html   # メインアプリ（単一ページ）
├── style.css    # スタイル（外部依存なし）
├── app.js       # アプリロジック
└── README.md    # このファイル
```

---

## GitHub Pages での公開

`main` ブランチをそのまま GitHub Pages として公開できます。

**Settings → Pages → Source: Deploy from a branch → Branch: `main` / `/ (root)`**

公開後は `https://<username>.github.io/<repository>/` でアクセスできます。
`index.html` をブラウザで直接開く（`file://` プロトコル）でも動作します。
