'use strict';

// --- LocalStorage keys ---
const LS_INDEX    = 'booksearch_index';
const LS_META     = (id) => `booksearch_meta_${id}`;
const LS_PAGES    = (id) => `booksearch_pages_${id}`;
const LS_TOC      = (id) => `booksearch_toc_${id}`;
const LS_SELECTED = 'booksearch_selected';

// --- External viewer ---
const VIEWER_BASE_URL = 'https://chokotia.github.io/book-viewer/';

// --- App state ---
let currentBookId   = null;
let currentPages    = [];
let currentTocIndex = null;
let debounceTimer   = null;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function normalize(str) {
  return str.normalize('NFKC').toLowerCase();
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// LocalStorage helpers
// ---------------------------------------------------------------------------

function getBookIndex() {
  try {
    return JSON.parse(localStorage.getItem(LS_INDEX) || '[]');
  } catch {
    return [];
  }
}

function getBookMeta(id) {
  try {
    return JSON.parse(localStorage.getItem(LS_META(id)));
  } catch {
    return null;
  }
}

function getBookPages(id) {
  try {
    return JSON.parse(localStorage.getItem(LS_PAGES(id)) || '[]');
  } catch {
    return [];
  }
}

function getBookToc(id) {
  try {
    return JSON.parse(localStorage.getItem(LS_TOC(id)));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

function showError(message) {
  const banner = document.getElementById('error-banner');
  banner.textContent = message;
  banner.hidden = false;
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => {
    banner.hidden = true;
  }, 3000);
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

function loadBookFromFile(file) {
  const reader = new FileReader();

  reader.onload = (e) => {
    // --- Parse ---
    let data;
    try {
      data = JSON.parse(e.target.result);
    } catch {
      showError('JSONの解析に失敗しました。ファイルの形式を確認してください。');
      return;
    }

    // --- Validate ---
    if (!data.metadata || typeof data.metadata.title !== 'string' || !data.metadata.title.trim()) {
      showError('無効なJSONです: metadata.title が見つかりません。');
      return;
    }
    if (!Array.isArray(data.pages)) {
      showError('無効なJSONです: pages が配列ではありません。');
      return;
    }
    if (data.pages.length === 0) {
      showError('無効なJSONです: pages が空です。');
      return;
    }
    if (typeof data.pages[0].content !== 'string') {
      showError('無効なJSONです: pages[0].content が文字列ではありません。');
      return;
    }

    // --- Duplicate check ---
    const newTitle = normalize(data.metadata.title.trim());
    for (const id of getBookIndex()) {
      const meta = getBookMeta(id);
      if (meta && normalize(meta.title.trim()) === newTitle) {
        showError(`「${data.metadata.title}」はすでに追加されています。`);
        return;
      }
    }

    // --- Save to localStorage ---
    const id = crypto.randomUUID();
    const meta = {
      title:       data.metadata.title,
      viewer_id:   data.metadata.viewer_id   ?? null,
      total_pages: data.metadata.total_pages ?? null,
      created_at:  data.metadata.created_at  ?? null,
      savedAt:     new Date().toISOString(),
    };
    const pages = data.pages.map((p) => ({ page: p.page, content: p.content }));

    try {
      localStorage.setItem(LS_META(id),  JSON.stringify(meta));
      localStorage.setItem(LS_PAGES(id), JSON.stringify(pages));
      if (Array.isArray(data.table_of_contents)) {
        localStorage.setItem(LS_TOC(id), JSON.stringify(data.table_of_contents));
      }
      const index = getBookIndex();
      index.push(id);
      localStorage.setItem(LS_INDEX, JSON.stringify(index));
    } catch {
      // Storage quota exceeded — roll back partial write
      localStorage.removeItem(LS_META(id));
      localStorage.removeItem(LS_PAGES(id));
      localStorage.removeItem(LS_TOC(id));
      showError('ストレージの容量が不足しています。不要な本を削除してください。');
      return;
    }

    renderBookList();
    selectBook(id);
  };

  reader.readAsText(file);
}

// ---------------------------------------------------------------------------
// TOC helpers
// ---------------------------------------------------------------------------

function buildTocIndex(toc) {
  if (!Array.isArray(toc) || toc.length === 0) return null;

  const entries = [];

  function traverse(items, ancestors) {
    for (const item of items) {
      const crumb = [...ancestors, item.title];
      entries.push({ page: item.page, breadcrumb: crumb });
      if (Array.isArray(item.items)) {
        traverse(item.items, crumb);
      }
    }
  }

  traverse(toc, []);
  entries.sort((a, b) => a.page - b.page);
  return entries;
}

function findBreadcrumb(tocIndex, pageNum) {
  if (!tocIndex || tocIndex.length === 0) return null;

  let result = null;
  for (let i = 0; i < tocIndex.length; i++) {
    const entry = tocIndex[i];
    if (entry.page > pageNum) break;
    const nextPage = i + 1 < tocIndex.length ? tocIndex[i + 1].page : Infinity;
    if (pageNum < nextPage) {
      result = entry.breadcrumb; // 同ページ複数エントリは最後（最深）を優先
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function search(query) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  return currentPages
    .filter((p) => terms.every((term) => normalize(p.content).includes(term)))
    .sort((a, b) => a.page - b.page);
}

// ---------------------------------------------------------------------------
// Excerpt extraction
// ---------------------------------------------------------------------------

function extractExcerpt(content, terms) {
  const normalizedContent = normalize(content);
  let firstMatchPos = Infinity;

  for (const term of terms) {
    const pos = normalizedContent.indexOf(term);
    if (pos !== -1 && pos < firstMatchPos) {
      firstMatchPos = pos;
    }
  }

  if (firstMatchPos === Infinity) return content.slice(0, 300);

  const start = Math.max(0, firstMatchPos - 150);
  const end   = Math.min(content.length, firstMatchPos + 150);

  let excerpt = content.slice(start, end);
  if (start > 0)              excerpt = '…' + excerpt;
  if (end < content.length)   excerpt = excerpt + '…';

  return excerpt;
}

// ---------------------------------------------------------------------------
// Highlight
// ---------------------------------------------------------------------------

function highlightText(text, terms) {
  const normalizedText = normalize(text);

  // Collect all match ranges in normalized text
  const ranges = [];
  for (const term of terms) {
    let pos = 0;
    while (true) {
      const idx = normalizedText.indexOf(term, pos);
      if (idx === -1) break;
      ranges.push([idx, idx + term.length]);
      pos = idx + 1;
    }
  }

  if (ranges.length === 0) return escapeHtml(text);

  // Sort and merge overlapping ranges
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of ranges) {
    if (merged.length && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else {
      merged.push([s, e]);
    }
  }

  // Build HTML using positions from normalized text applied to original text
  // (Positions coincide for NFKC when character widths are preserved)
  let result = '';
  let prev   = 0;
  for (const [s, e] of merged) {
    result += escapeHtml(text.slice(prev, s));
    result += '<mark>' + escapeHtml(text.slice(s, e)) + '</mark>';
    prev = e;
  }
  result += escapeHtml(text.slice(prev));

  return result;
}

// ---------------------------------------------------------------------------
// Book selection
// ---------------------------------------------------------------------------

function selectBook(id) {
  currentBookId   = id;
  currentPages    = getBookPages(id);
  currentTocIndex = buildTocIndex(getBookToc(id));
  localStorage.setItem(LS_SELECTED, id);

  const searchBox = document.getElementById('search-input');
  searchBox.value    = '';
  searchBox.disabled = false;

  document.getElementById('results-count').textContent = '';
  document.getElementById('results-area').innerHTML =
    '<p class="placeholder">キーワードを入力して検索してください</p>';

  renderBookList();
}

// ---------------------------------------------------------------------------
// Book deletion
// ---------------------------------------------------------------------------

function deleteBook(id) {
  const meta  = getBookMeta(id);
  const title = meta ? meta.title : 'この本';

  if (!window.confirm(`「${title}」を削除しますか？`)) return;

  localStorage.removeItem(LS_META(id));
  localStorage.removeItem(LS_PAGES(id));
  localStorage.removeItem(LS_TOC(id));

  const index = getBookIndex().filter((i) => i !== id);
  localStorage.setItem(LS_INDEX, JSON.stringify(index));

  if (currentBookId === id) {
    currentBookId = null;
    currentPages  = [];
    localStorage.removeItem(LS_SELECTED);

    const searchBox    = document.getElementById('search-input');
    searchBox.value    = '';
    searchBox.disabled = true;

    document.getElementById('results-count').textContent = '';
    document.getElementById('results-area').innerHTML =
      '<p class="placeholder">本を選択してください</p>';
  }

  renderBookList();
}

// ---------------------------------------------------------------------------
// Render book list (sidebar)
// ---------------------------------------------------------------------------

function renderBookList() {
  const list  = document.getElementById('book-list');
  const index = getBookIndex();

  if (index.length === 0) {
    list.innerHTML = '<p class="no-books">まだ本がありません</p>';
    return;
  }

  list.innerHTML = index
    .map((id) => {
      const meta = getBookMeta(id);
      if (!meta) return '';
      const isSelected = id === currentBookId;
      // UUIDs contain only [0-9a-f-] so inline onclick is safe here
      return `
        <div class="book-item ${isSelected ? 'selected' : ''}">
          <span class="book-radio">${isSelected ? '◉' : '○'}</span>
          <span class="book-title" onclick="selectBook('${id}')">${escapeHtml(meta.title)}</span>
          <button class="delete-btn" onclick="deleteBook('${id}')" title="削除">🗑</button>
        </div>
      `;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Page viewer
// ---------------------------------------------------------------------------

function buildPageViewerHTML(meta, pageNum, content, breadcrumb = null) {
  const titleSafe      = escapeHtml(meta.title);
  const contentSafe    = escapeHtml(content);
  const breadcrumbHtml = breadcrumb
    ? `<div class="page-breadcrumb">${escapeHtml(breadcrumb.join(' > '))}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>p.${pageNum} \u2014 ${titleSafe}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans',
        'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
      background: #f8fafc;
      color: #1e293b;
      padding: 2rem 1rem;
      min-height: 100vh;
    }
    .viewer { max-width: 800px; margin: 0 auto; }
    .viewer-header {
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid #e2e8f0;
    }
    .book-title-label { font-size: 0.9rem; color: #64748b; margin-bottom: 0.3rem; }
    .book-title-text  { font-size: 1.15rem; font-weight: 700; color: #1e293b; }
    .page-breadcrumb {
      margin-top: 0.4rem;
      font-size: 0.8rem;
      color: #64748b;
    }
    .page-label {
      margin-top: 0.5rem;
      display: inline-block;
      font-size: 0.78rem;
      font-weight: 700;
      color: #4f46e5;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: #eef2ff;
      padding: 0.2rem 0.55rem;
      border-radius: 4px;
    }
    .page-content {
      font-size: 1.05rem;
      line-height: 1.85;
      color: #1e293b;
      background: #ffffff;
      padding: 2rem;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06);
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: break-word;
    }
  </style>
</head>
<body>
  <div class="viewer">
    <div class="viewer-header">
      <div class="book-title-label">\u{1F4DA} \u672C\u306E\u30BF\u30A4\u30C8\u30EB</div>
      <div class="book-title-text">${titleSafe}</div>
      ${breadcrumbHtml}
      <span class="page-label">p.${pageNum}</span>
    </div>
    <div class="page-content">${contentSafe}</div>
  </div>
</body>
</html>`;
}

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
  const tocIndex  = buildTocIndex(getBookToc(bookId));
  const breadcrumb = findBreadcrumb(tocIndex, pageNum);
  const html = buildPageViewerHTML(meta, pageNum, page.content, breadcrumb);
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

// ---------------------------------------------------------------------------
// Render search results
// ---------------------------------------------------------------------------

function renderResults(results, terms) {
  const area     = document.getElementById('results-area');
  const countEl  = document.getElementById('results-count');

  if (results.length === 0) {
    countEl.textContent = `0件`;
    area.innerHTML = '<p class="placeholder">該当ページが見つかりませんでした</p>';
    return;
  }

  countEl.textContent = `${results.length}件`;
  area.innerHTML = results
    .map((page) => {
      const excerpt      = extractExcerpt(page.content, terms);
      const highlighted  = highlightText(excerpt, terms);
      const breadcrumb   = findBreadcrumb(currentTocIndex, page.page);
      const breadcrumbHtml = breadcrumb
        ? `<div class="result-breadcrumb">${escapeHtml(breadcrumb.join(' > '))}</div>`
        : '';
      // currentBookId と page.page はどちらも安全な値（UUID と整数）
      return `
        <div class="result-card" onclick="openPageViewer('${currentBookId}', ${page.page})">
          <div class="result-page">p.${page.page}</div>
          ${breadcrumbHtml}
          <div class="result-excerpt">${highlighted}</div>
        </div>
      `;
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function onSearchInput(e) {
  clearTimeout(debounceTimer);
  const query = e.target.value;

  if (!query.trim()) {
    document.getElementById('results-count').textContent = '';
    document.getElementById('results-area').innerHTML =
      '<p class="placeholder">キーワードを入力して検索してください</p>';
    return;
  }

  debounceTimer = setTimeout(() => {
    const terms   = normalize(query).trim().split(/\s+/).filter(Boolean);
    const results = search(query);
    renderResults(results, terms);
  }, 300);
}

function onFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  loadBookFromFile(file);
  e.target.value = ''; // reset so same file can be re-selected
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('search-input').addEventListener('input', onSearchInput);
  document.getElementById('file-input').addEventListener('change', onFileChange);
  document.getElementById('add-book-btn').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  renderBookList();

  // Restore previously selected book
  const savedId = localStorage.getItem(LS_SELECTED);
  if (savedId && getBookIndex().includes(savedId)) {
    selectBook(savedId);
  } else {
    document.getElementById('search-input').disabled = true;
    document.getElementById('results-area').innerHTML =
      '<p class="placeholder">本を選択してください</p>';
  }
});
