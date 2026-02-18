'use strict';

// --- LocalStorage keys ---
const LS_INDEX    = 'booksearch_index';
const LS_META     = (id) => `booksearch_meta_${id}`;
const LS_PAGES    = (id) => `booksearch_pages_${id}`;
const LS_SELECTED = 'booksearch_selected';

// --- App state ---
let currentBookId = null;
let currentPages  = [];
let debounceTimer = null;

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
      total_pages: data.metadata.total_pages ?? null,
      created_at:  data.metadata.created_at  ?? null,
      savedAt:     new Date().toISOString(),
    };
    const pages = data.pages.map((p) => ({ page: p.page, content: p.content }));

    try {
      localStorage.setItem(LS_META(id),  JSON.stringify(meta));
      localStorage.setItem(LS_PAGES(id), JSON.stringify(pages));
      const index = getBookIndex();
      index.push(id);
      localStorage.setItem(LS_INDEX, JSON.stringify(index));
    } catch {
      // Storage quota exceeded — roll back partial write
      localStorage.removeItem(LS_META(id));
      localStorage.removeItem(LS_PAGES(id));
      showError('ストレージの容量が不足しています。不要な本を削除してください。');
      return;
    }

    renderBookList();
    selectBook(id);
  };

  reader.readAsText(file);
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
  currentBookId = id;
  currentPages  = getBookPages(id);
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
      const excerpt     = extractExcerpt(page.content, terms);
      const highlighted = highlightText(excerpt, terms);
      return `
        <div class="result-card">
          <div class="result-page">p.${page.page}</div>
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
