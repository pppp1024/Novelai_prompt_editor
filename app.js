const STORAGE_KEY = "novelai_prompt_appData_v13";

let appData = {
  tabs: [
    { id: "tab-1", title: "タブ1", textPos: "", textNeg: "" }
  ],
  // ★ プリセットは「ポジ＋ネガ」両方を持つ
  presetGroups: [
    {
      id: "pg1",
      name: "共通プリセット",
      items: [
        { id: "preset-1", name: "高品質基本", textPos: "masterpiece, best quality, ultra-detailed, ", textNeg: "" },
        { id: "preset-2", name: "ネガティブ基本", textPos: "", textNeg: "lowres, blurry, worst quality, " }
      ]
    }
  ],
  /* ★ 候補は別ファイルから読み込む */
  candidateGroups: (window.CANDIDATE_GROUPS || []),
  // プリセット作成用の下書き（ポジ／ネガ）
  presetDraftPosText: "",
  presetDraftNegText: "",
  candidateCollapsed: {}
};

// 旧バージョンからの移行
const savedRaw =
  localStorage.getItem(STORAGE_KEY) ||
  localStorage.getItem("novelai_prompt_appData_v12") ||
  localStorage.getItem("novelai_prompt_appData_v11") ||
  localStorage.getItem("novelai_prompt_appData_v10") ||
  localStorage.getItem("novelai_prompt_appData_v9") ||
  localStorage.getItem("novelai_prompt_appData_v8") ||
  localStorage.getItem("novelai_prompt_appData_v7") ||
  localStorage.getItem("novelai_prompt_appData_v6") ||
  localStorage.getItem("novelai_prompt_appData_v5") ||
  localStorage.getItem("novelai_prompt_appData_v4") ||
  localStorage.getItem("novelai_prompt_appData_v3") ||
  localStorage.getItem("novelai_prompt_appData_v2") ||
  localStorage.getItem("novelai_prompt_appData_v1");

if (savedRaw) {
  try {
    const parsed = JSON.parse(savedRaw);
    if (parsed.tabs) {
      parsed.tabs.forEach(t => {
        if (t.textPos === undefined && t.text !== undefined) t.textPos = t.text;
        if (t.textNeg === undefined) t.textNeg = "";
      });
      appData.tabs = parsed.tabs;
    }

    // ★ プリセット: text → textPos/textNeg へマイグレーション
    if (parsed.presetGroups) {
      parsed.presetGroups.forEach(g => {
        if (!Array.isArray(g.items)) return;
        g.items.forEach(p => {
          if (p.textPos === undefined && p.text !== undefined) {
            p.textPos = p.text;
          }
          if (p.textNeg === undefined) {
            p.textNeg = "";
          }
        });
      });
      appData.presetGroups = parsed.presetGroups;
    } else if (parsed.presets) {
      let items = [];
      if (Array.isArray(parsed.presets) && parsed.presets.length > 0) {
        if (typeof parsed.presets[0] === "string") {
          items = parsed.presets.map((txt, idx) => ({
            id: "preset-migrated-" + idx,
            name: "プリセット" + (idx + 1),
            textPos: txt,
            textNeg: ""
          }));
        } else if (typeof parsed.presets[0] === "object") {
          items = parsed.presets.map((p, idx) => ({
            id: p.id || ("preset-migrated-" + idx),
            name: p.name || ("プリセット" + (idx + 1)),
            textPos: p.text || p.textPos || "",
            textNeg: p.textNeg || ""
          }));
        }
      }
      appData.presetGroups = [
        { id: "pg_migrated", name: "未分類", items }
      ];
    }

    if (parsed.candidateGroups) {
      appData.candidateGroups = parsed.candidateGroups;
    }

    // 旧フィールドから下書きを移行
    if (parsed.presetDraftPosText !== undefined) {
      appData.presetDraftPosText = parsed.presetDraftPosText;
    } else if (parsed.presetDraftText !== undefined) {
      appData.presetDraftPosText = parsed.presetDraftText;
    }
    if (parsed.presetDraftNegText !== undefined) {
      appData.presetDraftNegText = parsed.presetDraftNegText;
    }

    if (parsed.candidateCollapsed) {
      appData.candidateCollapsed = parsed.candidateCollapsed;
    }
  } catch (e) {
    console.warn("Failed to parse saved data", e);
  }
}

let candidateCollapsed = appData.candidateCollapsed || {};
appData.candidateCollapsed = candidateCollapsed;

let currentTabId = appData.tabs[0].id;
// "pos" | "neg" | "presetPos" | "presetNeg"
let activeEditor = "pos";
let activeView = "main";     // "main" | "preset"

const tabsEl = document.getElementById("tabs");
const mainView = document.getElementById("mainView");
const presetView = document.getElementById("presetView");

const editorPosEl = document.getElementById("editorPos");
const editorNegEl = document.getElementById("editorNeg");
const presetEditorPosEl = document.getElementById("presetEditorPos");
const presetEditorNegEl = document.getElementById("presetEditorNeg");

const wordsPosEl = document.getElementById("wordsPos");
const wordsNegEl = document.getElementById("wordsNeg");
const suggestionsEl = document.getElementById("suggestions");

// ★ どのエディタに対するサジェストかを保持
// kind: "pos" | "neg" | "presetPos" | "presetNeg"
// editor: 対象の textarea 要素
let currentSuggestionTarget = null;

// --- キャレット位置計算用のダミー要素 ---
const caretHelper = document.createElement("div");
caretHelper.style.position = "fixed";
caretHelper.style.visibility = "hidden";
caretHelper.style.whiteSpace = "pre-wrap";
caretHelper.style.wordWrap = "break-word";
caretHelper.style.pointerEvents = "none";
caretHelper.style.zIndex = 9999;
document.body.appendChild(caretHelper);

const presetCategorySelectEl = document.getElementById("presetCategorySelect");
const presetCreateBtn = document.getElementById("presetCreateBtn");

// Undo 系
const posUndoBtn = document.getElementById("posUndoBtn");
const negUndoBtn = document.getElementById("negUndoBtn");
const presetPosUndoBtn = document.getElementById("presetPosUndoBtn");
const presetNegUndoBtn = document.getElementById("presetNegUndoBtn");

const undoStack = {
  pos: [],
  neg: [],
  presetPos: [],
  presetNeg: []
};
const UNDO_LIMIT = 50;

function pushUndo(kind, value) {
  const stack = undoStack[kind];
  if (!stack) return;
  if (stack.length === 0 || stack[stack.length - 1] !== value) {
    stack.push(value);
    if (stack.length > UNDO_LIMIT) {
      stack.shift();
    }
  }
}

function popUndo(kind) {
  const stack = undoStack[kind];
  if (!stack || stack.length === 0) return null;
  return stack.pop();
}

// 値が変わる直前に保存する便利関数
function saveUndoBeforeChange(kind) {
  const current = getTextByKind(kind);
  pushUndo(kind, current);
}

// 候補系
let candidateEditMode = false;
let candidateMultiSelectMode = false;
let candidateSelectedItems = [];

// プリセットモーダル系
const presetCollapsed = {};
let presetMultiSelectMode = false;
let presetSelectedItems = [];
const presetModal = document.getElementById("presetModal");
const presetSelectListEl = document.getElementById("presetSelectList");
const presetMultiToggleEl = document.getElementById("presetMultiToggle");
const presetMultiAddBtn = document.getElementById("presetMultiAddBtn");
const presetPreviewEl = document.getElementById("presetPreview");

// 適用方法（追加 / 上書き）
let presetApplyMode = "append";
const presetApplyModeRadios = document.querySelectorAll('input[name="presetApplyMode"]');
presetApplyModeRadios.forEach(radio => {
  radio.addEventListener("change", (e) => {
    if (e.target.checked) {
      presetApplyMode = e.target.value; // "append" or "overwrite"
    }
  });
});

// 単語編集モーダル関連
const wordsEditModal = document.getElementById("wordsEditModal");
const wordsEditTitleEl = document.getElementById("wordsEditTitle");
const wordsEditListEl = document.getElementById("wordsEditList");
// "pos" | "neg" | "presetPos" | "presetNeg"
let wordsEditKind = "pos";
let dragInfoWordEdit = null;
let wordsMultiSelectMode = false;
let selectedWordIndices = new Set();

// タブ編集モーダル
const tabEditModal = document.getElementById("tabEditModal");
const tabEditListEl = document.getElementById("tabEditList");

// プリセットカテゴリ編集モーダル
const presetCategoryEditModal = document.getElementById("presetCategoryEditModal");
const presetCategoryEditListEl = document.getElementById("presetCategoryEditList");
const presetCategoryEditCollapsed = {};

// ヘルプモーダル
const helpModal = document.getElementById("helpModal");
document.getElementById("helpBtn").onclick = () => {
  helpModal.style.display = "flex";
};
function closeHelpModal() {
  helpModal.style.display = "none";
}
window.closeHelpModal = closeHelpModal;

// バックアップモーダル
const backupModal = document.getElementById("backupModal");
const backupTextarea = document.getElementById("backupTextarea");
const backupExportBtn = document.getElementById("backupExportBtn");
const backupImportBtn = document.getElementById("backupImportBtn");
document.getElementById("backupBtn").onclick = () => {
  backupTextarea.value = "";
  backupModal.style.display = "flex";
};
function closeBackupModal() {
  backupModal.style.display = "none";
}
window.closeBackupModal = closeBackupModal;

backupExportBtn.onclick = () => {
  try {
    const json = JSON.stringify(appData, null, 2);
    backupTextarea.value = json;
    backupTextarea.focus();
    backupTextarea.select();
  } catch (e) {
    alert("JSONの生成に失敗しました。");
    console.error(e);
  }
};

backupImportBtn.onclick = () => {
  const text = backupTextarea.value.trim();
  if (!text) {
    alert("復元するJSONが空です。保存しておいたJSONを貼り付けてください。");
    return;
  }
  if (!confirm("このJSONで現在のデータをすべて上書きしてもよろしいですか？")) {
    return;
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      alert("このJSONには有効な tabs データが含まれていません。");
      return;
    }
    parsed.tabs.forEach(t => {
      if (t.textPos === undefined && t.text !== undefined) t.textPos = t.text;
      if (t.textNeg === undefined) t.textNeg = "";
    });
    if (!parsed.candidateGroups) parsed.candidateGroups = [];
    if (!parsed.presetGroups) parsed.presetGroups = [];

    // ★ バックアップ復元時もプリセットをマイグレーション
    parsed.presetGroups.forEach(g => {
      if (!Array.isArray(g.items)) return;
      g.items.forEach(p => {
        if (p.textPos === undefined && p.text !== undefined) {
          p.textPos = p.text;
        }
        if (p.textNeg === undefined) {
          p.textNeg = "";
        }
      });
    });

    if (parsed.presetDraftPosText === undefined && parsed.presetDraftText !== undefined) {
      parsed.presetDraftPosText = parsed.presetDraftText;
    }
    if (parsed.presetDraftPosText === undefined) parsed.presetDraftPosText = "";
    if (parsed.presetDraftNegText === undefined) parsed.presetDraftNegText = "";
    if (!parsed.candidateCollapsed) parsed.candidateCollapsed = {};

    appData = parsed;
    candidateCollapsed = appData.candidateCollapsed || {};
    appData.candidateCollapsed = candidateCollapsed;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));

    currentTabId = appData.tabs[0].id;
    activeView = "main";
    activeEditor = "pos";

    candidateSelectedItems = [];
    presetSelectedItems = [];
    selectedWordIndices.clear();
    wordsMultiSelectMode = false;
    candidateMultiSelectMode = false;
    presetMultiSelectMode = false;

    renderTabs();
    updateView();
    alert("バックアップから復元しました。");
    closeBackupModal();
  } catch (e) {
    console.error(e);
    alert("JSONの読み込みに失敗しました。形式が正しいか確認してください。");
  }
};

function saveAppData() {
  appData.candidateCollapsed = candidateCollapsed;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

function getCurrentTab() {
  return appData.tabs.find(t => t.id === currentTabId);
}

function renderTabs() {
  tabsEl.innerHTML = "";
  appData.tabs.forEach(tab => {
    const isActiveMain = (activeView === "main" && tab.id === currentTabId);
    const btn = document.createElement("button");
    btn.className = "tab-button" + (isActiveMain ? " active" : "");
    btn.textContent = tab.title;
    btn.onclick = () => {
      activeView = "main";
      currentTabId = tab.id;
      updateView();
      renderTabs();
    };
    tabsEl.appendChild(btn);
  });

  const presetBtn = document.createElement("button");
  presetBtn.className = "tab-button" + (activeView === "preset" ? " active" : "");
  presetBtn.textContent = "プリセット";
  presetBtn.onclick = () => {
    activeView = "preset";
    updateView();
    renderTabs();
  };
  tabsEl.appendChild(presetBtn);
}

function updateView() {
  if (activeView === "main") {
    mainView.style.display = "block";
    presetView.style.display = "none";
    const tab = getCurrentTab();
    if (tab) {
      editorPosEl.value = tab.textPos || "";
      editorNegEl.value = tab.textNeg || "";
      syncWordsFromPosText(tab.textPos || "");
      syncWordsFromNegText(tab.textNeg || "");
    }
    activeEditor = "pos";
  } else {
    mainView.style.display = "none";
    presetView.style.display = "block";
    presetEditorPosEl.value = appData.presetDraftPosText || "";
    presetEditorNegEl.value = appData.presetDraftNegText || "";
    activeEditor = "presetPos";
    renderPresetCategoryOptions();
  }
}

function getTokensFromText(text) {
  return text
    .split(",")
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

function hasTrailingComma(text) {
  return /,\s*$/.test(text);
}

function getTextByKind(kind) {
  if (kind === "pos") return editorPosEl.value || "";
  if (kind === "neg") return editorNegEl.value || "";
  if (kind === "presetPos") return presetEditorPosEl.value || "";
  if (kind === "presetNeg") return presetEditorNegEl.value || "";
  return "";
}

function setTextFromTokens(kind, tokens, keepTrailingComma = false) {
  let newText = tokens.join(", ");
  if (keepTrailingComma && newText.length > 0 && !/,\s*$/.test(newText)) newText += ", ";

  if (kind === "pos") {
    const tab = getCurrentTab();
    if (!tab) return;
    tab.textPos = newText;
    editorPosEl.value = newText;
    saveAppData();
    syncWordsFromPosText(newText);
  } else if (kind === "neg") {
    const tab = getCurrentTab();
    if (!tab) return;
    tab.textNeg = newText;
    editorNegEl.value = newText;
    saveAppData();
    syncWordsFromNegText(newText);
  } else if (kind === "presetPos") {
    appData.presetDraftPosText = newText;
    presetEditorPosEl.value = newText;
    saveAppData();
  } else if (kind === "presetNeg") {
    appData.presetDraftNegText = newText;
    presetEditorNegEl.value = newText;
    saveAppData();
  }
}

// --- 強調・弱体トークン ---
function parseWeightToken(tok) {
  const m = tok.match(/^\s*(\d+(?:\.\d+)?)::(.*)::\s*$/);
  if (m) return { weight: parseFloat(m[1]), base: m[2] };
  return { weight: null, base: tok };
}

function buildWeightedToken(base, weight) {
  if (weight == null) return base;
  let w = Math.round(weight * 10) / 10;
  if (w < 0.1) w = 0.1;
  return `${w.toFixed(1)}::${base}::`;
}

function adjustWeight(kind, idx, delta) {
  const text = getTextByKind(kind);
  const tokens = getTokensFromText(text);
  if (idx < 0 || idx >= tokens.length) return;
  const parsed = parseWeightToken(tokens[idx]);

  let w = parsed.weight;
  if (w == null) {
    w = delta > 0 ? 1.1 : 0.9;
  } else {
    w = w + delta;
  }
  if (w < 0.1) w = 0.1;

  tokens[idx] = buildWeightedToken(parsed.base, w);
  const keepComma = hasTrailingComma(text);
  setTextFromTokens(kind, tokens, keepComma);
  renderWordsEditList();
}

function applyWeightToSelected(delta) {
  if (!wordsMultiSelectMode || selectedWordIndices.size === 0) return;
  const kind = wordsEditKind;

  // ★ ここで Undo を積む
  saveUndoBeforeChange(kind);

  const text = getTextByKind(kind);
  const tokens = getTokensFromText(text);
  const keepComma = hasTrailingComma(text);
  const selected = Array.from(selectedWordIndices).sort((a, b) => a - b);

  selected.forEach(idx => {
    if (idx < 0 || idx >= tokens.length) return;
    const parsed = parseWeightToken(tokens[idx]);
    let w = parsed.weight;
    if (w == null) {
      w = delta > 0 ? 1.1 : 0.9;
    } else {
      w = w + delta;
    }
    if (w < 0.1) w = 0.1;
    tokens[idx] = buildWeightedToken(parsed.base, w);
  });

  setTextFromTokens(kind, tokens, keepComma);
  renderWordsEditList();
}

function deleteSelectedWords() {
  if (!wordsMultiSelectMode || selectedWordIndices.size === 0) return;
  const kind = wordsEditKind;

  // ★ ここで Undo を積む
  saveUndoBeforeChange(kind);

  const text = getTextByKind(kind);
  const tokens = getTokensFromText(text);
  const keepComma = hasTrailingComma(text);
  const selected = Array.from(selectedWordIndices).sort((a, b) => a - b);
  const selSet = new Set(selected);
  const newTokens = tokens.filter((_, idx) => !selSet.has(idx));
  setTextFromTokens(kind, newTokens, keepComma);
  selectedWordIndices.clear();
  renderWordsEditList();
}

// --- サジェスト関連 ---
// カーソル直前の「最後のフレーズ」を取得（カンマ・改行区切り）
function getCurrentToken(text, cursorPos) {
  const left = text.slice(0, cursorPos);
  const parts = left.split(/[,、\n]/);
  const last = parts[parts.length - 1] || "";
  return last.trim();
}

function getAllCandidates() {
  return appData.candidateGroups
    .flatMap(g => g.items)
    .filter(x => x && x.trim().length > 0);
}

function hideSuggestions() {
  suggestionsEl.innerHTML = "";
  suggestionsEl.style.display = "none";
  currentSuggestionTarget = null;
}

// キャレット位置にサジェストボックスを移動
function updateSuggestionPosition(editorEl) {
  if (!editorEl) return;
  const rect = editorEl.getBoundingClientRect();
  const style = window.getComputedStyle(editorEl);

  caretHelper.style.font = style.font;
  caretHelper.style.padding = style.padding;
  caretHelper.style.border = style.border;
  caretHelper.style.boxSizing = style.boxSizing;
  caretHelper.style.whiteSpace = "pre-wrap";
  caretHelper.style.wordWrap = "break-word";
  caretHelper.style.width = rect.width + "px";

  caretHelper.style.left = rect.left + "px";
  caretHelper.style.top = rect.top + "px";

  const text = editorEl.value || "";
  const cursorPos = editorEl.selectionStart || 0;
  const before = text.slice(0, cursorPos);

  caretHelper.textContent = before;
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  caretHelper.appendChild(marker);

  const markerRect = marker.getBoundingClientRect();

  suggestionsEl.style.position = "fixed";
  suggestionsEl.style.left = markerRect.left + "px";
  suggestionsEl.style.top = (markerRect.bottom + 4) + "px";
}

// サジェスト描画（部分一致・カーソル位置ベース）
function renderSuggestions(currentToken, candidates, kind, editorEl) {
  suggestionsEl.innerHTML = "";
  if (!currentToken) {
    hideSuggestions();
    return;
  }

  const lower = currentToken.toLowerCase();
  let filtered = candidates.filter(c => c.toLowerCase().includes(lower));
  if (filtered.length === 0) {
    hideSuggestions();
    return;
  }

  filtered.sort((a, b) => {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    const aStarts = la.startsWith(lower);
    const bStarts = lb.startsWith(lower);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
    return la.localeCompare(lb);
  });

  filtered.slice(0, 10).forEach(c => {
    const btn = document.createElement("button");
    btn.className = "suggestion-btn";
    btn.textContent = c;
    btn.onclick = () => applySuggestion(currentToken, c);
    suggestionsEl.appendChild(btn);
  });

  currentSuggestionTarget = { kind, editor: editorEl, token: currentToken };
  updateSuggestionPosition(editorEl);
  suggestionsEl.style.display = "block";
}

// 共通サジェスト更新
function updateSuggestionsForEditor(kind, editorEl) {
  if (!editorEl) {
    hideSuggestions();
    return;
  }
  const text = editorEl.value || "";
  const cursorPos = editorEl.selectionStart || 0;
  const currentToken = getCurrentToken(text, cursorPos);
  const candidates = getAllCandidates();
  renderSuggestions(currentToken, candidates, kind, editorEl);
}

// サジェスト確定
function applySuggestion(currentToken, suggestion) {
  if (!currentSuggestionTarget) return;

  const { kind, editor } = currentSuggestionTarget;
  if (!editor) return;

  // Undo 対応
  saveUndoBeforeChange(kind);

  const originalText = editor.value || "";
  const pos = editor.selectionStart || 0;
  const left = originalText.slice(0, pos);
  const right = originalText.slice(pos);

  // currentToken をそのまま置き換える（末尾一致）
  let pattern;
  if (currentToken && currentToken.length > 0) {
    const escaped = currentToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(escaped + "$");
  } else {
    pattern = /([^,、\n]+)$/;
  }

  const tokenWithComma = suggestion + ", ";
  const replacedLeft = left.replace(pattern, tokenWithComma);
  const newText = replacedLeft + right;
  const newCursorPos = replacedLeft.length;

  if (kind === "pos" || kind === "neg") {
    const tab = getCurrentTab();
    if (!tab) return;

    if (kind === "pos") {
      tab.textPos = newText;
      editorPosEl.value = newText;
      syncWordsFromPosText(newText);
    } else {
      tab.textNeg = newText;
      editorNegEl.value = newText;
      syncWordsFromNegText(newText);
    }
  } else if (kind === "presetPos") {
    appData.presetDraftPosText = newText;
    presetEditorPosEl.value = newText;
  } else if (kind === "presetNeg") {
    appData.presetDraftNegText = newText;
    presetEditorNegEl.value = newText;
  }

  saveAppData();

  // スマホでの「変換中」状態をきっちり終わらせるため、一度 blur → 再 focus
  editor.blur();
  setTimeout(() => {
    editor.focus();
    editor.setSelectionRange(newCursorPos, newCursorPos);
    updateSuggestionsForEditor(kind, editor);
  }, 0);
}

// --- IME（日本語変換）時のハンドラ ---
let composingKind = null;  // 今どのエディタで変換中か（必要なら拡張用）

// kind: "pos" | "neg" | "presetPos" | "presetNeg"
function attachCompositionHandlers(kind, editorEl) {
  if (!editorEl) return;

  // 変換開始
  editorEl.addEventListener("compositionstart", () => {
    composingKind = kind;
  });

  // 変換中：途中でも候補を更新
  editorEl.addEventListener("compositionupdate", () => {
    updateSuggestionsForEditor(kind, editorEl);
  });

  // 変換確定
  editorEl.addEventListener("compositionend", () => {
    composingKind = null;
    updateSuggestionsForEditor(kind, editorEl);
  });
}

// --- 単語リスト描画系 ---
function syncWordsFromPosText(text) {
  const tokens = getTokensFromText(text);
  renderWords(tokens, "pos");
}

function syncWordsFromNegText(text) {
  const tokens = getTokensFromText(text);
  renderWords(tokens, "neg");
}

function renderWords(tokens, kind) {
  const container = (kind === "neg") ? wordsNegEl : wordsPosEl;
  if (!container) return;
  container.innerHTML = "";
  tokens.forEach(tok => {
    const span = document.createElement("span");
    span.className = "chip";
    const label = document.createElement("span");
    label.className = "chip-label";
    label.textContent = tok;
    span.appendChild(label);
    container.appendChild(span);
  });
}

// --- Undo ボタンの動作 ---
posUndoBtn.onclick = () => {
  const prev = popUndo("pos");
  if (prev == null) return;
  const tab = getCurrentTab();
  if (!tab) return;
  tab.textPos = prev;
  editorPosEl.value = prev;
  saveAppData();
  syncWordsFromPosText(prev);
};

negUndoBtn.onclick = () => {
  const prev = popUndo("neg");
  if (prev == null) return;
  const tab = getCurrentTab();
  if (!tab) return;
  tab.textNeg = prev;
  editorNegEl.value = prev;
  saveAppData();
  syncWordsFromNegText(prev);
};

// ★ プリセットタブの Undo（ポジ／ネガそれぞれ）
presetPosUndoBtn.onclick = () => {
  const prev = popUndo("presetPos");
  if (prev == null) return;
  appData.presetDraftPosText = prev;
  presetEditorPosEl.value = prev;
  saveAppData();
};
presetNegUndoBtn.onclick = () => {
  const prev = popUndo("presetNeg");
  if (prev == null) return;
  appData.presetDraftNegText = prev;
  presetEditorNegEl.value = prev;
  saveAppData();
};

// --- 各テキストエリアのイベント（サジェスト対応版） ---
editorPosEl.addEventListener("input", () => {
  const tab = getCurrentTab();
  if (!tab) return;
  tab.textPos = editorPosEl.value;
  saveAppData();
  syncWordsFromPosText(editorPosEl.value);
  updateSuggestionsForEditor("pos", editorPosEl);
});
editorPosEl.addEventListener("keyup", () => {
  updateSuggestionsForEditor("pos", editorPosEl);
});
editorPosEl.addEventListener("click", () => {
  updateSuggestionsForEditor("pos", editorPosEl);
});

editorNegEl.addEventListener("input", () => {
  const tab = getCurrentTab();
  if (!tab) return;
  tab.textNeg = editorNegEl.value;
  saveAppData();
  syncWordsFromNegText(editorNegEl.value);
  updateSuggestionsForEditor("neg", editorNegEl);
});
editorNegEl.addEventListener("keyup", () => {
  updateSuggestionsForEditor("neg", editorNegEl);
});
editorNegEl.addEventListener("click", () => {
  updateSuggestionsForEditor("neg", editorNegEl);
});

// プリセットタブのテキストエリア入力
presetEditorPosEl.addEventListener("input", () => {
  appData.presetDraftPosText = presetEditorPosEl.value;
  saveAppData();
  updateSuggestionsForEditor("presetPos", presetEditorPosEl);
});
presetEditorPosEl.addEventListener("keyup", () => {
  updateSuggestionsForEditor("presetPos", presetEditorPosEl);
});
presetEditorPosEl.addEventListener("click", () => {
  updateSuggestionsForEditor("presetPos", presetEditorPosEl);
});

presetEditorNegEl.addEventListener("input", () => {
  appData.presetDraftNegText = presetEditorNegEl.value;
  saveAppData();
  updateSuggestionsForEditor("presetNeg", presetEditorNegEl);
});
presetEditorNegEl.addEventListener("keyup", () => {
  updateSuggestionsForEditor("presetNeg", presetEditorNegEl);
});
presetEditorNegEl.addEventListener("click", () => {
  updateSuggestionsForEditor("presetNeg", presetEditorNegEl);
});

// IME 用ハンドラを各エディタに付与
attachCompositionHandlers("pos",        editorPosEl);
attachCompositionHandlers("neg",        editorNegEl);
attachCompositionHandlers("presetPos",  presetEditorPosEl);
attachCompositionHandlers("presetNeg",  presetEditorNegEl);

// ★ エディタやサジェスト以外をクリックしたらサジェストを閉じる
document.addEventListener("click", (e) => {
  const target = e.target;

  // サジェスト内クリックなら閉じない
  if (suggestionsEl.contains(target)) return;

  // 各エディタ自体をクリックした場合も閉じない
  if (
    target === editorPosEl ||
    target === editorNegEl ||
    target === presetEditorPosEl ||
    target === presetEditorNegEl
  ) {
    return;
  }

  hideSuggestions();
});

editorPosEl.addEventListener("focus", () => { activeEditor = "pos"; });
editorNegEl.addEventListener("focus", () => { activeEditor = "neg"; });
presetEditorPosEl.addEventListener("focus", () => { activeEditor = "presetPos"; });
presetEditorNegEl.addEventListener("focus", () => { activeEditor = "presetNeg"; });

document.getElementById("copyPosBtn").onclick = async () => {
  try {
    await navigator.clipboard.writeText(editorPosEl.value);
    alert("ポジティブプロンプトをコピーしました");
  } catch {
    alert("コピーに失敗しました");
  }
};
document.getElementById("copyNegBtn").onclick = async () => {
  try {
    await navigator.clipboard.writeText(editorNegEl.value);
    alert("ネガティブプロンプトをコピーしました");
  } catch {
    alert("コピーに失敗しました");
  }
};

function clearEditor(kind) {
  if (kind === "pos") {
    const tab = getCurrentTab();
    if (!tab) return;
    tab.textPos = "";
    editorPosEl.value = "";
    saveAppData();
    syncWordsFromPosText("");
  } else if (kind === "neg") {
    const tab = getCurrentTab();
    if (!tab) return;
    tab.textNeg = "";
    editorNegEl.value = "";
    saveAppData();
    syncWordsFromNegText("");
  } else if (kind === "presetPos") {
    appData.presetDraftPosText = "";
    presetEditorPosEl.value = "";
    saveAppData();
  } else if (kind === "presetNeg") {
    appData.presetDraftNegText = "";
    presetEditorNegEl.value = "";
    saveAppData();
  }
}

// クリアボタン（押す前にUndoに積む）
document.getElementById("posClearBtn").onclick = () => {
  saveUndoBeforeChange("pos");
  clearEditor("pos");
};
document.getElementById("negClearBtn").onclick = () => {
  saveUndoBeforeChange("neg");
  clearEditor("neg");
};
const presetPosClearBtn = document.getElementById("presetPosClearBtn");
const presetNegClearBtn = document.getElementById("presetNegClearBtn");
presetPosClearBtn.onclick = () => {
  saveUndoBeforeChange("presetPos");
  clearEditor("presetPos");
};
presetNegClearBtn.onclick = () => {
  saveUndoBeforeChange("presetNeg");
  clearEditor("presetNeg");
};

// タブ追加
document.getElementById("newTabBtn").onclick = () => {
  const id = "tab-" + Date.now();
  const title = "タブ" + (appData.tabs.length + 1);
  appData.tabs.push({ id, title, textPos: "", textNeg: "" });
  currentTabId = id;
  activeView = "main";
  saveAppData();
  renderTabs();
  updateView();
};

document.getElementById("editTabsBtn").onclick = () => {
  renderTabEditList();
  tabEditModal.style.display = "flex";
};

function closeTabEditModal() {
  tabEditModal.style.display = "none";
}
window.closeTabEditModal = closeTabEditModal;

function renderTabEditList() {
  tabEditListEl.innerHTML = "";
  appData.tabs.forEach((tab, idx) => {
    const row = document.createElement("div");
    row.className = "candidate-row";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = tab.title;
    if (tab.id === currentTabId && activeView === "main") {
      nameInput.style.fontWeight = "600";
    }
    nameInput.oninput = (e) => {
      tab.title = e.target.value;
      saveAppData();
      renderTabs();
    };

    const upBtn = document.createElement("button");
    upBtn.textContent = "↑";
    upBtn.disabled = (idx === 0);
    upBtn.onclick = () => {
      if (idx === 0) return;
      const tmp = appData.tabs[idx - 1];
      appData.tabs[idx - 1] = appData.tabs[idx];
      appData.tabs[idx] = tmp;
      saveAppData();
      renderTabs();
      renderTabEditList();
    };

    const downBtn = document.createElement("button");
    downBtn.textContent = "↓";
    downBtn.disabled = (idx === appData.tabs.length - 1);
    downBtn.onclick = () => {
      if (idx === appData.tabs.length - 1) return;
      const tmp = appData.tabs[idx + 1];
      appData.tabs[idx + 1] = appData.tabs[idx];
      appData.tabs[idx] = tmp;
      saveAppData();
      renderTabs();
      renderTabEditList();
    };

    const delBtn = document.createElement("button");
    delBtn.textContent = "削除";
    delBtn.onclick = () => {
      if (appData.tabs.length === 1) {
        alert("タブが1つだけのときは削除できません。");
        return;
      }
      if (!confirm(`タブ「${tab.title}」を削除しますか？`)) return;

      const removingCurrent = (tab.id === currentTabId);
      appData.tabs.splice(idx, 1);
      if (removingCurrent) {
        const newIdx = Math.max(0, idx - 1);
        currentTabId = appData.tabs[newIdx].id;
      }
      activeView = "main";
      saveAppData();
      renderTabs();
      updateView();
      renderTabEditList();
    };

    row.appendChild(nameInput);
    row.appendChild(upBtn);
    row.appendChild(downBtn);
    row.appendChild(delBtn);

    tabEditListEl.appendChild(row);
  });
}

// --- 候補ページ ---
const candidatePage = document.getElementById("candidatePage");
const candidateButtonList = document.getElementById("candidateButtonList");
const candidateSelectView = document.getElementById("candidateSelectView");
const candidateEditView = document.getElementById("candidateEditView");
const toggleCandidateEditBtn = document.getElementById("toggleCandidateEditBtn");
const candidateEditListEl = document.getElementById("candidateEditList");
const newGroupNameInputEl = document.getElementById("newGroupNameInput");
const addGroupBtn = document.getElementById("addGroupBtn");
const quickAddGroupSelectEl = document.getElementById("quickAddGroupSelect");
const quickTagInputEl = document.getElementById("quickTagInput");
const addQuickTagBtn = document.getElementById("addQuickTagBtn");
const candidateMultiToggleEl = document.getElementById("candidateMultiToggle");
const candidateMultiAddBtn = document.getElementById("candidateMultiAddBtn");

document.getElementById("openCandidatesBtn").onclick = () => {
  activeEditor = "pos";
  candidateEditMode = false;
  candidateMultiSelectMode = false;
  candidateSelectedItems = [];
  candidateMultiToggleEl.checked = false;
  updateCandidateModeView();
  candidatePage.style.display = "flex";
};
document.getElementById("openCandidatesNegBtn").onclick = () => {
  activeEditor = "neg";
  candidateEditMode = false;
  candidateMultiSelectMode = false;
  candidateSelectedItems = [];
  candidateMultiToggleEl.checked = false;
  updateCandidateModeView();
  candidatePage.style.display = "flex";
};
// プリセットタブ用：ポジ
document.getElementById("presetOpenCandidatesPosBtn").onclick = () => {
  activeEditor = "presetPos";
  candidateEditMode = false;
  candidateMultiSelectMode = false;
  candidateSelectedItems = [];
  candidateMultiToggleEl.checked = false;
  updateCandidateModeView();
  candidatePage.style.display = "flex";
};
// プリセットタブ用：ネガ
document.getElementById("presetOpenCandidatesNegBtn").onclick = () => {
  activeEditor = "presetNeg";
  candidateEditMode = false;
  candidateMultiSelectMode = false;
  candidateSelectedItems = [];
  candidateMultiToggleEl.checked = false;
  updateCandidateModeView();
  candidatePage.style.display = "flex";
};

toggleCandidateEditBtn.onclick = () => {
  candidateEditMode = !candidateEditMode;
  updateCandidateModeView();
};

candidateMultiToggleEl.onchange = (e) => {
  candidateMultiSelectMode = e.target.checked;
  candidateSelectedItems = [];
  renderCandidateSelectView();
};

candidateMultiAddBtn.onclick = () => {
  if (!candidateMultiSelectMode || candidateSelectedItems.length === 0) return;
  const values = candidateSelectedItems.map(sel => {
    const g = appData.candidateGroups.find(gg => gg.id === sel.groupId);
    if (!g) return null;
    return g.items[sel.index];
  }).filter(v => !!v);
  insertMultipleCandidatesToActiveEditor(values);
  candidateSelectedItems = [];
  candidateMultiSelectMode = false;
  candidateMultiToggleEl.checked = false;
  renderCandidateSelectView();
  closeCandidatePage();
};

function updateCandidateModeView() {
  if (candidateEditMode) {
    toggleCandidateEditBtn.textContent = "選択モード";
    candidateSelectView.style.display = "none";
    candidateEditView.style.display = "block";
    refreshQuickAddGroupOptions();
    renderCandidateEditList();
  } else {
    toggleCandidateEditBtn.textContent = "編集";
    candidateSelectView.style.display = "block";
    candidateEditView.style.display = "none";
    renderCandidateSelectView();
  }
}

function closeCandidatePage() {
  candidatePage.style.display = "none";
}
window.closeCandidatePage = closeCandidatePage;

function renderCandidateSelectView() {
  candidateButtonList.innerHTML = "";
  appData.candidateGroups.forEach(group => {
    if (candidateCollapsed[group.id] === undefined) {
      candidateCollapsed[group.id] = true; // 初回は閉じる
    }
    const collapsed = !!candidateCollapsed[group.id];

    const groupDiv = document.createElement("div");
    groupDiv.className = "candidate-group";

    const header = document.createElement("div");
    header.className = "candidate-group-header";

    const titleSpan = document.createElement("span");
    titleSpan.textContent = group.name;

    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = collapsed ? "＋ 開く" : "－ 閉じる";
    toggleBtn.onclick = () => {
      candidateCollapsed[group.id] = !collapsed;
      saveAppData();
      renderCandidateSelectView();
    };

    header.appendChild(titleSpan);
    header.appendChild(toggleBtn);

    const itemsDiv = document.createElement("div");
    itemsDiv.className = "candidate-group-items";
    itemsDiv.style.display = collapsed ? "none" : "flex";

    group.items.forEach((item, idx) => {
      const b = document.createElement("button");
      b.textContent = item;

      if (candidateMultiSelectMode &&
        candidateSelectedItems.some(sel => sel.groupId === group.id && sel.index === idx)) {
        b.classList.add("selected");
      }

      b.onclick = () => {
        if (!candidateMultiSelectMode) {
          // 挿入前にUndoに積む
          saveUndoBeforeChange(activeEditor);
          insertMultipleCandidatesToActiveEditor([item]);
          closeCandidatePage();
        } else {
          const i = candidateSelectedItems.findIndex(
            sel => sel.groupId === group.id && sel.index === idx
          );
          if (i >= 0) {
            candidateSelectedItems.splice(i, 1);
            b.classList.remove("selected");
          } else {
            candidateSelectedItems.push({ groupId: group.id, index: idx });
            b.classList.add("selected");
          }
        }
      };
      itemsDiv.appendChild(b);
    });

    groupDiv.appendChild(header);
    groupDiv.appendChild(itemsDiv);
    candidateButtonList.appendChild(groupDiv);
  });
}

function insertMultipleCandidatesToActiveEditor(values) {
  if (!values || values.length === 0) return;
  const combined = values.join(", ") + ", ";

  // プリセットタブ（ポジ／ネガ）
  if (activeEditor === "presetPos" || activeEditor === "presetNeg") {
    const editor = (activeEditor === "presetNeg") ? presetEditorNegEl : presetEditorPosEl;
    const originalText = editor.value;
    const pos = editor.selectionStart || originalText.length;
    const left = originalText.slice(0, pos);
    const right = originalText.slice(pos);
    const insert = (left.trim().length === 0 || left.endsWith(", ") || left.endsWith(" "))
      ? combined
      : " " + combined;
    const newText = left + insert + right;

    if (activeEditor === "presetNeg") {
      appData.presetDraftNegText = newText;
    } else {
      appData.presetDraftPosText = newText;
    }
    editor.value = newText;
    saveAppData();
    editor.blur();
    return;
  }

  // メイン（ポジ／ネガ）
  const tab = getCurrentTab();
  if (!tab) return;
  const targetKind = (activeEditor === "neg") ? "neg" : "pos";
  const editor = (targetKind === "neg") ? editorNegEl : editorPosEl;
  const originalText = editor.value;
  const pos = editor.selectionStart || originalText.length;
  const left = originalText.slice(0, pos);
  const right = originalText.slice(pos);
  const insert = (left.trim().length === 0 || left.endsWith(", ") || left.endsWith(" "))
    ? combined
    : " " + combined;
  const newText = left + insert + right;

  if (targetKind === "neg") {
    tab.textNeg = newText;
    editorNegEl.value = newText;
    syncWordsFromNegText(newText);
  } else {
    tab.textPos = newText;
    editorPosEl.value = newText;
    syncWordsFromPosText(newText);
  }
  saveAppData();
  editor.blur();
}

function refreshQuickAddGroupOptions() {
  quickAddGroupSelectEl.innerHTML = "";
  appData.candidateGroups.forEach(g => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    quickAddGroupSelectEl.appendChild(opt);
  });
}

function renderCandidateEditList() {
  candidateEditListEl.innerHTML = "";
  appData.candidateGroups.forEach((group, gi) => {
    if (candidateCollapsed[group.id] === undefined) {
      candidateCollapsed[group.id] = true;
    }
    const collapsed = !!candidateCollapsed[group.id];

    const groupBox = document.createElement("div");
    groupBox.className = "candidate-group";

    const headerRow = document.createElement("div");
    headerRow.className = "candidate-row";

    const collapseBtn = document.createElement("button");
    collapseBtn.textContent = collapsed ? "＋" : "－";
    collapseBtn.onclick = () => {
      candidateCollapsed[group.id] = !collapsed;
      saveAppData();
      renderCandidateEditList();
    };

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = group.name;
    nameInput.oninput = (e) => {
      group.name = e.target.value;
      saveAppData();
      refreshQuickAddGroupOptions();
    };

    headerRow.appendChild(collapseBtn);
    headerRow.appendChild(nameInput);
    groupBox.appendChild(headerRow);

    const delRow = document.createElement("div");
    delRow.className = "candidate-row";
    delRow.style.justifyContent = "flex-end";

    const upGroupBtn = document.createElement("button");
    upGroupBtn.textContent = "↑";
    upGroupBtn.disabled = (gi === 0);
    upGroupBtn.onclick = () => {
      if (gi === 0) return;
      const tmp = appData.candidateGroups[gi - 1];
      appData.candidateGroups[gi - 1] = appData.candidateGroups[gi];
      appData.candidateGroups[gi] = tmp;
      saveAppData();
      refreshQuickAddGroupOptions();
      renderCandidateEditList();
    };

    const downGroupBtn = document.createElement("button");
    downGroupBtn.textContent = "↓";
    downGroupBtn.disabled = (gi === appData.candidateGroups.length - 1);
    downGroupBtn.onclick = () => {
      if (gi === appData.candidateGroups.length - 1) return;
      const tmp = appData.candidateGroups[gi + 1];
      appData.candidateGroups[gi + 1] = appData.candidateGroups[gi];
      appData.candidateGroups[gi] = tmp;
      saveAppData();
      refreshQuickAddGroupOptions();
      renderCandidateEditList();
    };

    const delGroupBtn = document.createElement("button");
    delGroupBtn.textContent = "カテゴリ削除";
    delGroupBtn.onclick = () => {
      if (appData.candidateGroups.length === 1) {
        alert("カテゴリが1つだけの時は削除できません。");
        return;
      }
      if (!confirm(`カテゴリ「${group.name}」を削除しますか？\nこのカテゴリ内の単語もすべて削除されます。`)) {
        return;
      }
      appData.candidateGroups.splice(gi, 1);
      delete candidateCollapsed[group.id];
      saveAppData();
      refreshQuickAddGroupOptions();
      renderCandidateEditList();
    };

    delRow.appendChild(upGroupBtn);
    delRow.appendChild(downGroupBtn);
    delRow.appendChild(delGroupBtn);
    groupBox.appendChild(delRow);

    const itemsContainer = document.createElement("div");
    itemsContainer.style.display = collapsed ? "none" : "block";

    group.items.forEach((item, ii) => {
      const row = document.createElement("div");
      row.className = "candidate-row";

      const input = document.createElement("input");
      input.type = "text";
      input.value = item;
      input.oninput = (e) => {
        group.items[ii] = e.target.value;
        saveAppData();
      };

      const upItemBtn = document.createElement("button");
      upItemBtn.textContent = "↑";
      upItemBtn.disabled = (ii === 0);
      upItemBtn.onclick = () => {
        if (ii === 0) return;
        const tmp = group.items[ii - 1];
        group.items[ii - 1] = group.items[ii];
        group.items[ii] = tmp;
        saveAppData();
        renderCandidateEditList();
      };

      const downItemBtn = document.createElement("button");
      downItemBtn.textContent = "↓";
      downItemBtn.disabled = (ii === group.items.length - 1);
      downItemBtn.onclick = () => {
        if (ii === group.items.length - 1) return;
        const tmp = group.items[ii + 1];
        group.items[ii + 1] = group.items[ii];
        group.items[ii] = tmp;
        saveAppData();
        renderCandidateEditList();
      };

      const delBtn = document.createElement("button");
      delBtn.textContent = "削除";
      delBtn.onclick = () => {
        group.items.splice(ii, 1);
        saveAppData();
        renderCandidateEditList();
      };

      row.appendChild(input);
      row.appendChild(upItemBtn);
      row.appendChild(downItemBtn);
      row.appendChild(delBtn);
      itemsContainer.appendChild(row);
    });

    groupBox.appendChild(itemsContainer);
    candidateEditListEl.appendChild(groupBox);
  });
}

addGroupBtn.onclick = () => {
  const name = newGroupNameInputEl.value.trim();
  if (!name) return;
  const id = "g_" + Date.now();
  appData.candidateGroups.push({ id, name, items: [] });
  candidateCollapsed[id] = true;
  newGroupNameInputEl.value = "";
  saveAppData();
  refreshQuickAddGroupOptions();
  renderCandidateEditList();
};

addQuickTagBtn.onclick = () => {
  const gid = quickAddGroupSelectEl.value;
  const v = quickTagInputEl.value.trim();
  if (!gid || !v) return;
  const group = appData.candidateGroups.find(g => g.id === gid);
  if (!group) return;
  group.items.push(v);
  quickTagInputEl.value = "";
  saveAppData();
  renderCandidateEditList();
};

// --- 単語編集モーダル ---
document.getElementById("editWordsBtn").onclick = () => {
  wordsEditKind = "pos";
  wordsEditTitleEl.textContent = "単語編集（ポジティブ）";
  wordsMultiSelectMode = false;
  selectedWordIndices.clear();
  renderWordsEditList();
  wordsEditModal.style.display = "flex";
};
document.getElementById("editWordsNegBtn").onclick = () => {
  wordsEditKind = "neg";
  wordsEditTitleEl.textContent = "単語編集（ネガティブ）";
  wordsMultiSelectMode = false;
  selectedWordIndices.clear();
  renderWordsEditList();
  wordsEditModal.style.display = "flex";
};
// プリセットタブ用：ポジ
document.getElementById("presetEditWordsPosBtn").onclick = () => {
  wordsEditKind = "presetPos";
  wordsEditTitleEl.textContent = "単語編集（プリセット・ポジティブ）";
  wordsMultiSelectMode = false;
  selectedWordIndices.clear();
  renderWordsEditList();
  wordsEditModal.style.display = "flex";
};
// プリセットタブ用：ネガ
document.getElementById("presetEditWordsNegBtn").onclick = () => {
  wordsEditKind = "presetNeg";
  wordsEditTitleEl.textContent = "単語編集（プリセット・ネガティブ）";
  wordsMultiSelectMode = false;
  selectedWordIndices.clear();
  renderWordsEditList();
  wordsEditModal.style.display = "flex";
};

function closeWordsEditModal() {
  wordsEditModal.style.display = "none";
  dragInfoWordEdit = null;
}
window.closeWordsEditModal = closeWordsEditModal;

function renderWordsEditList() {
  const kind = wordsEditKind;
  const text = getTextByKind(kind);
  const tokens = getTokensFromText(text);

  wordsEditListEl.innerHTML = "";

  const hint = document.createElement("p");
  hint.className = "words-edit-hint";
  hint.textContent = "ヒント：チップを長押ししてドラッグすると並び替えができます。複数選択モードをオンにすると、タップで複数の単語を選べます。";
  wordsEditListEl.appendChild(hint);

  if (tokens.length === 0) {
    const p = document.createElement("p");
    p.className = "words-edit-empty";
    p.textContent = "まだ単語がありません。テキストエリアに「,」区切りで単語を入力してください。";
    wordsEditListEl.appendChild(p);
    return;
  }

  const toolbar = document.createElement("div");
  toolbar.className = "words-edit-toolbar modal-subtoolbar";

  const multiLabel = document.createElement("label");
  const multiChk = document.createElement("input");
  multiChk.type = "checkbox";
  multiChk.checked = wordsMultiSelectMode;
  multiChk.onchange = (e) => {
    wordsMultiSelectMode = e.target.checked;
    selectedWordIndices.clear();
    renderWordsEditList();
  };
  multiLabel.appendChild(multiChk);
  multiLabel.appendChild(document.createTextNode(" 複数選択モード"));

  const plusBtnSel = document.createElement("button");
  plusBtnSel.textContent = "選択を＋0.1";
  plusBtnSel.onclick = () => applyWeightToSelected(+0.1);

  const minusBtnSel = document.createElement("button");
  minusBtnSel.textContent = "選択を−0.1";
  minusBtnSel.onclick = () => applyWeightToSelected(-0.1);

  const delBtnSel = document.createElement("button");
  delBtnSel.textContent = "選択削除";
  delBtnSel.onclick = () => deleteSelectedWords();

  toolbar.appendChild(multiLabel);
  toolbar.appendChild(plusBtnSel);
  toolbar.appendChild(minusBtnSel);
  toolbar.appendChild(delBtnSel);
  wordsEditListEl.appendChild(toolbar);

  const chipsContainer = document.createElement("div");
  chipsContainer.className = "words-edit-chips";

  tokens.forEach((tok, idx) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.dataset.index = idx;
    if (wordsMultiSelectMode && selectedWordIndices.has(idx)) {
      chip.classList.add("selected");
    }

    const parsed = parseWeightToken(tok);

    const label = document.createElement("span");
    label.className = "chip-label";
    label.textContent = tok;

    const plusBtn = document.createElement("button");
    plusBtn.className = "chip-weight-btn";
    plusBtn.textContent = "+";
    plusBtn.title = "強調（+0.1）";

    const minusBtn = document.createElement("button");
    minusBtn.className = "chip-weight-btn";
    minusBtn.textContent = "−";
    minusBtn.title = "弱体（-0.1）";

    const weightInput = document.createElement("input");
    weightInput.className = "chip-weight-input";
    weightInput.type = "number";
    weightInput.step = "0.1";
    weightInput.min = "0.1";
    weightInput.value = parsed.weight != null ? parsed.weight.toFixed(1) : "";
    weightInput.placeholder = "w";

    function changeWeightForThis(delta) {
      // ★ まず Undo を積む（この時点ではまだ変更前のテキスト）
      saveUndoBeforeChange(kind);

      const currentText = getTextByKind(kind);
      const tks = getTokensFromText(currentText);
      if (idx < 0 || idx >= tks.length) return;

      const parsedNow = parseWeightToken(tks[idx]);
      let w = parsedNow.weight;
      if (w == null) {
        w = delta > 0 ? 1.1 : 0.9;
      } else {
        w = w + delta;
      }
      if (w < 0.1) w = 0.1;

      tks[idx] = buildWeightedToken(parsedNow.base, w);
      const keepCommaNow = hasTrailingComma(currentText);
      setTextFromTokens(kind, tks, keepCommaNow);

      label.textContent = tks[idx];
      const parsedAfter = parseWeightToken(tks[idx]);
      if (parsedAfter.weight != null) {
        weightInput.value = parsedAfter.weight.toFixed(1);
      } else {
        weightInput.value = "";
      }
    }

    function setupHoldButton(btn, delta) {
      let holdTimeout = null;
      let repeatInterval = null;

      const stop = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (holdTimeout) {
          clearTimeout(holdTimeout);
          holdTimeout = null;
        }
        if (repeatInterval) {
          clearInterval(repeatInterval);
          repeatInterval = null;
        }
      };

      const start = (e) => {
        e.preventDefault();
        e.stopPropagation();
        changeWeightForThis(delta);
        holdTimeout = setTimeout(() => {
          repeatInterval = setInterval(() => {
            changeWeightForThis(delta);
          }, 120);
        }, 400);
      };

      btn.addEventListener("mousedown", start);
      btn.addEventListener("touchstart", start, { passive: false });
      btn.addEventListener("mouseup", stop);
      btn.addEventListener("mouseleave", stop);
      btn.addEventListener("touchend", stop);
      btn.addEventListener("touchcancel", stop);
    }

    setupHoldButton(plusBtn, +0.1);
    setupHoldButton(minusBtn, -0.1);

    weightInput.onchange = (e) => {
      e.stopPropagation();
      const val = e.target.value.trim();

      // ★ ここで Undo を積む
      saveUndoBeforeChange(kind);

      const currentText = getTextByKind(kind);
      const tks = getTokensFromText(currentText);
      if (idx < 0 || idx >= tks.length) return;

      const baseParsed = parseWeightToken(tks[idx]);

      if (val === "") {
        tks[idx] = baseParsed.base;
      } else {
        const num = parseFloat(val);
        if (!isNaN(num) && num > 0) {
          tks[idx] = buildWeightedToken(baseParsed.base, num);
        } else {
          weightInput.value = baseParsed.weight != null ? baseParsed.weight.toFixed(1) : "";
          return;
        }
      }
      const keepCommaNow = hasTrailingComma(currentText);
      setTextFromTokens(kind, tks, keepCommaNow);
      renderWordsEditList();
    };

    const closeBtn = document.createElement("button");
    closeBtn.className = "chip-close";
    closeBtn.textContent = "×";
    closeBtn.onclick = (e) => {
      e.stopPropagation();

      // ★ 削除前に Undo を積む
      saveUndoBeforeChange(kind);

      const currentText = getTextByKind(kind);
      const tks = getTokensFromText(currentText);
      tks.splice(idx, 1);
      const keepCommaNow = hasTrailingComma(currentText);
      setTextFromTokens(kind, tks, keepCommaNow);
      renderWordsEditList();
    };

    // --- タッチドラッグ ---
    chip.addEventListener("touchstart", (e) => {
      if (!e.touches || e.touches.length === 0) return;
      const t = e.touches[0];
      dragInfoWordEdit = {
        startX: t.clientX,
        startY: t.clientY,
        index: idx,
        chipEl: chip,
        dragging: false
      };
    }, { passive: true });

    chip.addEventListener("touchmove", (e) => {
      if (!dragInfoWordEdit) return;
      if (!e.touches || e.touches.length === 0) return;
      const t = e.touches[0];
      const dx = t.clientX - dragInfoWordEdit.startX;
      const dy = t.clientY - dragInfoWordEdit.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (!dragInfoWordEdit.dragging && dist > 5) {
        dragInfoWordEdit.dragging = true;
        dragInfoWordEdit.chipEl.classList.add("dragging");
      }
      if (dragInfoWordEdit.dragging) {
        e.preventDefault();
      }
    }, { passive: false });

    chip.addEventListener("touchend", (e) => {
      if (!dragInfoWordEdit) return;
      const info = dragInfoWordEdit;
      dragInfoWordEdit = null;
      info.chipEl.classList.remove("dragging");

      const currentIdx = info.index;

      if (!info.dragging) {
        if (wordsMultiSelectMode) {
          if (selectedWordIndices.has(currentIdx)) {
            selectedWordIndices.delete(currentIdx);
          } else {
            selectedWordIndices.add(currentIdx);
          }
          renderWordsEditList();
        }
        return;
      }

      // ★ ドラッグで順番を変える前に Undo を積む
      saveUndoBeforeChange(kind);

      if (!e.changedTouches || e.changedTouches.length === 0) return;
      const t = e.changedTouches[0];
      const target = document.elementFromPoint(t.clientX, t.clientY);
      if (!target) return;
      const targetChip = target.closest(".chip");
      if (!targetChip || !targetChip.parentElement.isSameNode(chipsContainer)) return;
      const toIndex = Number(targetChip.dataset.index);
      if (Number.isNaN(toIndex)) return;

      const currentText = getTextByKind(kind);
      const tks = getTokensFromText(currentText);
      const keepCommaNow = hasTrailingComma(currentText);

      let blockIndices;
      if (wordsMultiSelectMode && selectedWordIndices.size > 0) {
        blockIndices = Array.from(selectedWordIndices).sort((a, b) => a - b);
      } else {
        blockIndices = [currentIdx];
      }

      const selSet = new Set(blockIndices);
      const block = [];
      const remain = [];
      tks.forEach((v, i) => {
        if (selSet.has(i)) block.push(v);
        else remain.push(v);
      });

      let dropOriginal = toIndex;
      let countBefore = 0;
      blockIndices.forEach(i => {
        if (i < dropOriginal) countBefore++;
      });
      let dropIndex = dropOriginal - countBefore;
      if (dropIndex < 0) dropIndex = 0;
      if (dropIndex > remain.length) dropIndex = remain.length;

      const newTokens = remain.slice(0, dropIndex).concat(block, remain.slice(dropIndex));
      setTextFromTokens(kind, newTokens, keepCommaNow);

      if (wordsMultiSelectMode && block.length > 1) {
        selectedWordIndices = new Set();
        for (let i = 0; i < block.length; i++) {
          selectedWordIndices.add(dropIndex + i);
        }
      } else if (wordsMultiSelectMode && block.length === 1) {
        selectedWordIndices = new Set([dropIndex]);
      }

      renderWordsEditList();
    });

    // --- PCマウス用ドラッグ ---
    chip.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragInfoWordEdit = {
        startX: e.clientX,
        startY: e.clientY,
        index: idx,
        chipEl: chip,
        dragging: false
      };
    });

    chip.addEventListener("mousemove", (e) => {
      if (!dragInfoWordEdit) return;
      const dx = e.clientX - dragInfoWordEdit.startX;
      const dy = e.clientY - dragInfoWordEdit.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (!dragInfoWordEdit.dragging && dist > 5) {
        dragInfoWordEdit.dragging = true;
        dragInfoWordEdit.chipEl.classList.add("dragging");
      }
      if (dragInfoWordEdit.dragging) {
        e.preventDefault();
      }
    });

    chip.addEventListener("mouseup", (e) => {
      if (!dragInfoWordEdit) return;
      const info = dragInfoWordEdit;
      dragInfoWordEdit = null;
      info.chipEl.classList.remove("dragging");

      const currentIdx = info.index;

      if (!info.dragging) {
        if (wordsMultiSelectMode) {
          if (selectedWordIndices.has(currentIdx)) {
            selectedWordIndices.delete(currentIdx);
          } else {
            selectedWordIndices.add(currentIdx);
          }
          renderWordsEditList();
        }
        return;
      }

      // ★ 並び替え前に Undo を積む
      saveUndoBeforeChange(kind);

      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target) return;
      const targetChip = target.closest(".chip");
      if (!targetChip || !targetChip.parentElement.isSameNode(chipsContainer)) return;
      const toIndex = Number(targetChip.dataset.index);
      if (Number.isNaN(toIndex)) return;

      const currentText = getTextByKind(kind);
      const tks = getTokensFromText(currentText);
      const keepCommaNow = hasTrailingComma(currentText);

      let blockIndices;
      if (wordsMultiSelectMode && selectedWordIndices.size > 0) {
        blockIndices = Array.from(selectedWordIndices).sort((a, b) => a - b);
      } else {
        blockIndices = [currentIdx];
      }

      const selSet = new Set(blockIndices);
      const block = [];
      const remain = [];
      tks.forEach((v, i) => {
        if (selSet.has(i)) block.push(v);
        else remain.push(v);
      });

      let dropOriginal = toIndex;
      let countBefore = 0;
      blockIndices.forEach(i => {
        if (i < dropOriginal) countBefore++;
      });
      let dropIndex = dropOriginal - countBefore;
      if (dropIndex < 0) dropIndex = 0;
      if (dropIndex > remain.length) dropIndex = remain.length;

      const newTokens = remain.slice(0, dropIndex).concat(block, remain.slice(dropIndex));
      setTextFromTokens(kind, newTokens, keepCommaNow);

      if (wordsMultiSelectMode && block.length > 1) {
        selectedWordIndices = new Set();
        for (let i = 0; i < block.length; i++) {
          selectedWordIndices.add(dropIndex + i);
        }
      } else if (wordsMultiSelectMode && block.length === 1) {
        selectedWordIndices = new Set([dropIndex]);
      }

      renderWordsEditList();
    });

    chip.appendChild(label);
    chip.appendChild(plusBtn);
    chip.appendChild(minusBtn);
    chip.appendChild(weightInput);
    chip.appendChild(closeBtn);
    chipsContainer.appendChild(chip);
  });

  wordsEditListEl.appendChild(chipsContainer);
}

// --- プリセットカテゴリ選択＆ボタンラベル ---
function updatePresetCreateButtonLabel() {
  presetCreateBtn.textContent = "追加";
}

function renderPresetCategoryOptions() {
  presetCategorySelectEl.innerHTML = "";
  if (!appData.presetGroups || appData.presetGroups.length === 0) {
    const id = "pg_" + Date.now();
    appData.presetGroups.push({ id, name: "未分類", items: [] });
    saveAppData();
  }
  appData.presetGroups.forEach(g => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    presetCategorySelectEl.appendChild(opt);
  });
  if (!appData.presetGroups.some(g => g.id === presetCategorySelectEl.value)) {
    presetCategorySelectEl.value = appData.presetGroups[0].id;
  }
  updatePresetCreateButtonLabel();
}

presetCategorySelectEl.addEventListener("change", () => {
  updatePresetCreateButtonLabel();
});

// --- プリセットカテゴリ編集モーダル ---
document.getElementById("openPresetCategoryEditBtn").onclick = () => {
  renderPresetCategoryEditList();
  presetCategoryEditModal.style.display = "flex";
};

function closePresetCategoryEditModal() {
  presetCategoryEditModal.style.display = "none";
}
window.closePresetCategoryEditModal = closePresetCategoryEditModal;

function renderPresetCategoryEditList() {
  presetCategoryEditListEl.innerHTML = "";

  const addRow = document.createElement("div");
  addRow.className = "candidate-row";

  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.placeholder = "新しいカテゴリ名";

  const addBtn = document.createElement("button");
  addBtn.textContent = "カテゴリ追加";
  addBtn.onclick = () => {
    const name = addInput.value.trim();
    if (!name) return;
    const id = "pg_" + Date.now();
    appData.presetGroups.push({ id, name, items: [] });
    addInput.value = "";
    saveAppData();
    renderPresetCategoryOptions();
    renderPresetCategoryEditList();
  };

  addRow.appendChild(addInput);
  addRow.appendChild(addBtn);
  presetCategoryEditListEl.appendChild(addRow);

  if (!appData.presetGroups || appData.presetGroups.length === 0) {
    const p = document.createElement("p");
    p.textContent = "カテゴリがありません。";
    p.style.fontSize = "12px";
    presetCategoryEditListEl.appendChild(p);
    return;
  }

  appData.presetGroups.forEach((group, idx) => {
    const groupBox = document.createElement("div");
    groupBox.className = "candidate-group";

    const collapsed = !!presetCategoryEditCollapsed[group.id];

    const headerRow = document.createElement("div");
    headerRow.className = "candidate-row";

    const collapseBtn = document.createElement("button");
    collapseBtn.textContent = collapsed ? "＋" : "－";
    collapseBtn.onclick = () => {
      presetCategoryEditCollapsed[group.id] = !collapsed;
      renderPresetCategoryEditList();
    };

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = group.name;
    nameInput.oninput = (e) => {
      group.name = e.target.value;
      saveAppData();
      renderPresetCategoryOptions();
    };

    const countSpan = document.createElement("span");
    countSpan.textContent = `（${group.items.length} 件）`;
    countSpan.style.fontSize = "11px";
    countSpan.style.alignSelf = "center";

    headerRow.appendChild(collapseBtn);
    headerRow.appendChild(nameInput);
    headerRow.appendChild(countSpan);
    groupBox.appendChild(headerRow);

    const controlRow = document.createElement("div");
    controlRow.className = "candidate-row";
    controlRow.style.justifyContent = "flex-end";

    const upBtn = document.createElement("button");
    upBtn.textContent = "↑";
    upBtn.disabled = (idx === 0);
    upBtn.onclick = () => {
      if (idx === 0) return;
      const tmp = appData.presetGroups[idx - 1];
      appData.presetGroups[idx - 1] = appData.presetGroups[idx];
      appData.presetGroups[idx] = tmp;
      saveAppData();
      renderPresetCategoryOptions();
      renderPresetCategoryEditList();
    };

    const downBtn = document.createElement("button");
    downBtn.textContent = "↓";
    downBtn.disabled = (idx === appData.presetGroups.length - 1);
    downBtn.onclick = () => {
      if (idx === appData.presetGroups.length - 1) return;
      const tmp = appData.presetGroups[idx + 1];
      appData.presetGroups[idx + 1] = appData.presetGroups[idx];
      appData.presetGroups[idx] = tmp;
      saveAppData();
      renderPresetCategoryOptions();
      renderPresetCategoryEditList();
    };

    const delBtn = document.createElement("button");
    delBtn.textContent = "削除";
    delBtn.onclick = () => {
      if (appData.presetGroups.length === 1) {
        alert("カテゴリが1つだけのときは削除できません。");
        return;
      }
      if (!confirm(
        `カテゴリ「${group.name}」を削除しますか？\nこのカテゴリ内のプリセット（${group.items.length} 件）もすべて削除されます。`
      )) {
        return;
      }
      const removingId = group.id;
      appData.presetGroups.splice(idx, 1);
      saveAppData();
      renderPresetCategoryOptions();
      if (presetCategorySelectEl.value === removingId && appData.presetGroups.length > 0) {
        presetCategorySelectEl.value = appData.presetGroups[0].id;
        updatePresetCreateButtonLabel();
      }
      renderPresetCategoryEditList();
    };

    controlRow.appendChild(upBtn);
    controlRow.appendChild(downBtn);
    controlRow.appendChild(delBtn);
    groupBox.appendChild(controlRow);

    const itemsContainer = document.createElement("div");
    itemsContainer.style.display = collapsed ? "none" : "block";

    if (group.items.length > 0) {
      group.items.forEach((preset, pi) => {
        const row = document.createElement("div");
        row.className = "candidate-row";
        row.style.flexDirection = "column";

        const nameRow = document.createElement("div");
        nameRow.className = "candidate-row";

        const pnameInput = document.createElement("input");
        pnameInput.type = "text";
        pnameInput.value = preset.name;
        pnameInput.oninput = (e) => {
          preset.name = e.target.value;
          saveAppData();
          renderPresetList();
        };

        const pDelBtn = document.createElement("button");
        pDelBtn.textContent = "プリセット削除";
        pDelBtn.onclick = () => {
          if (!confirm(`プリセット「${preset.name}」を削除しますか？`)) return;
          group.items.splice(pi, 1);
          saveAppData();
          renderPresetCategoryEditList();
        };

        nameRow.appendChild(pnameInput);
        nameRow.appendChild(pDelBtn);

        // テキスト編集（ポジ／ネガ）
        const textRowPos = document.createElement("div");
        textRowPos.className = "candidate-row";
        const textAreaPos = document.createElement("textarea");
        textAreaPos.placeholder = "ポジティブ";
        textAreaPos.value = preset.textPos || "";
        textAreaPos.oninput = (e) => {
          preset.textPos = e.target.value;
          saveAppData();
        };
        textRowPos.appendChild(textAreaPos);

        const textRowNeg = document.createElement("div");
        textRowNeg.className = "candidate-row";
        const textAreaNeg = document.createElement("textarea");
        textAreaNeg.placeholder = "ネガティブ";
        textAreaNeg.value = preset.textNeg || "";
        textAreaNeg.oninput = (e) => {
          preset.textNeg = e.target.value;
          saveAppData();
        };
        textRowNeg.appendChild(textAreaNeg);

        row.appendChild(nameRow);
        row.appendChild(textRowPos);
        row.appendChild(textRowNeg);
        itemsContainer.appendChild(row);
      });
    } else {
      const emptyMsg = document.createElement("p");
      emptyMsg.textContent = "このカテゴリにはまだプリセットがありません。";
      emptyMsg.style.fontSize = "11px";
      emptyMsg.style.margin = "4px 0 0";
      itemsContainer.appendChild(emptyMsg);
    }

    groupBox.appendChild(itemsContainer);
    presetCategoryEditListEl.appendChild(groupBox);
  });
}

// --- プリセットモーダル ---
function openPresetModal() {
  presetMultiSelectMode = false;
  presetSelectedItems = [];
  presetMultiToggleEl.checked = false;
  presetPreviewEl.textContent = "";
  renderPresetList();
  presetModal.style.display = "flex";
}
function closePresetModal() { presetModal.style.display = "none"; }
window.closePresetModal = closePresetModal;

function renderPresetList() {
  presetSelectListEl.innerHTML = "";
  if (!appData.presetGroups || appData.presetGroups.length === 0) {
    const p = document.createElement("p");
    p.textContent = "まだプリセットがありません。上部タブの「プリセット」から作成できます。";
    p.style.fontSize = "12px";
    presetSelectListEl.appendChild(p);
    return;
  }

  appData.presetGroups.forEach(group => {
    const groupDiv = document.createElement("div");
    groupDiv.className = "candidate-group";

    const header = document.createElement("div");
    header.className = "candidate-group-header";
    const title = document.createElement("span");
    title.textContent = group.name;

    const toggleBtn = document.createElement("button");
    const collapsed = !!presetCollapsed[group.id];
    toggleBtn.textContent = collapsed ? "＋ 開く" : "－ 閉じる";
    toggleBtn.onclick = () => {
      presetCollapsed[group.id] = !collapsed;
      renderPresetList();
    };

    header.appendChild(title);
    header.appendChild(toggleBtn);
    groupDiv.appendChild(header);

    const itemsDiv = document.createElement("div");
    itemsDiv.className = "candidate-group-items";
    itemsDiv.style.display = collapsed ? "none" : "flex";

    group.items.forEach((preset, idx) => {
      const b = document.createElement("button");
      b.textContent = preset.name;

      if (presetMultiSelectMode &&
        presetSelectedItems.some(sel => sel.groupId === group.id && sel.index === idx)) {
        b.classList.add("selected");
      }

      b.onclick = () => {
        presetPreviewEl.textContent =
          `【${preset.name}】\n` +
          "[ポジティブ]\n" + (preset.textPos || "") + "\n\n" +
          "[ネガティブ]\n" + (preset.textNeg || "");

        if (!presetMultiSelectMode) {
          // プリセット適用前にポジ／ネガ両方に Undo を積む
          saveUndoBeforeChange("pos");
          saveUndoBeforeChange("neg");
          applyPresetsToCurrentTab([preset]);
          closePresetModal();
        } else {
          const i = presetSelectedItems.findIndex(
            sel => sel.groupId === group.id && sel.index === idx
          );
          if (i >= 0) {
            presetSelectedItems.splice(i, 1);
            b.classList.remove("selected");
          } else {
            presetSelectedItems.push({ groupId: group.id, index: idx });
            b.classList.add("selected");
          }
        }
      };

      itemsDiv.appendChild(b);
    });

    groupDiv.appendChild(itemsDiv);
    presetSelectListEl.appendChild(groupDiv);
  });
}

presetMultiToggleEl.onchange = (e) => {
  presetMultiSelectMode = e.target.checked;
  presetSelectedItems = [];
  renderPresetList();
};

presetMultiAddBtn.onclick = () => {
  if (!presetMultiSelectMode || presetSelectedItems.length === 0) return;
  const presets = presetSelectedItems.map(sel => {
    const g = appData.presetGroups.find(gg => gg.id === sel.groupId);
    if (!g) return null;
    const p = g.items[sel.index];
    return p || null;
  }).filter(v => !!v);
  if (presets.length === 0) return;

  saveUndoBeforeChange("pos");
  saveUndoBeforeChange("neg");
  applyPresetsToCurrentTab(presets);
  presetSelectedItems = [];
  presetMultiSelectMode = false;
  presetMultiToggleEl.checked = false;
  renderPresetList();
  closePresetModal();
};

// ★ プリセットを「現在のタブ」に適用（ポジ／ネガ両方）
//    適用方法は presetApplyMode ("append" | "overwrite") で制御
function applyPresetsToCurrentTab(presets) {
  const tab = getCurrentTab();
  if (!tab) return;

  const basePos = tab.textPos || "";
  const baseNeg = tab.textNeg || "";
  const posParts = [];
  const negParts = [];

  presets.forEach(p => {
    if (!p) return;
    const tp = (p.textPos || "").trim();
    const tn = (p.textNeg || "").trim();
    if (tp) posParts.push(tp);
    if (tn) negParts.push(tn);
  });

  if (posParts.length === 0 && negParts.length === 0) return;

  const combinedPos = posParts.join("\n");
  const combinedNeg = negParts.join("\n");

  let newPos = basePos;
  let newNeg = baseNeg;

  if (presetApplyMode === "overwrite") {
    // 上書き：値がある側だけ置き換え（空の方はそのまま）
    if (posParts.length > 0) newPos = combinedPos;
    if (negParts.length > 0) newNeg = combinedNeg;
  } else {
    // 追加：末尾に改行して足す
    if (posParts.length > 0) {
      newPos = basePos ? (basePos + "\n" + combinedPos) : combinedPos;
    }
    if (negParts.length > 0) {
      newNeg = baseNeg ? (baseNeg + "\n" + combinedNeg) : combinedNeg;
    }
  }

  tab.textPos = newPos;
  tab.textNeg = newNeg;
  editorPosEl.value = newPos;
  editorNegEl.value = newNeg;
  syncWordsFromPosText(newPos);
  syncWordsFromNegText(newNeg);
  saveAppData();
}

document.getElementById("openPresetsBtn").onclick = () => {
  activeEditor = "pos";
  openPresetModal();
};
document.getElementById("openPresetsNegBtn").onclick = () => {
  activeEditor = "neg";
  openPresetModal();
};

// --- プリセット作成（追加）ボタン ---
presetCreateBtn.onclick = () => {
  const textPos = (appData.presetDraftPosText || "").trim();
  const textNeg = (appData.presetDraftNegText || "").trim();
  if (!textPos && !textNeg) {
    alert("ポジティブとネガティブのどちらも空です。プリセットを作成できません。");
    return;
  }
  const name = prompt("このプリセットの名前を入力してください。", "新しいプリセット");
  if (!name) return;

  if (!appData.presetGroups || appData.presetGroups.length === 0) {
    const id = "pg_" + Date.now();
    appData.presetGroups.push({ id, name: "未分類", items: [] });
  }
  let groupId = presetCategorySelectEl.value;
  if (!groupId) groupId = appData.presetGroups[0].id;

  const group = appData.presetGroups.find(g => g.id === groupId) || appData.presetGroups[0];

  const id = "preset-" + Date.now();
  group.items.push({ id, name, textPos, textNeg });
  saveAppData();
  alert(`カテゴリ「${group.name}」にプリセットを追加しました。`);
  renderPresetCategoryOptions();
};

// 初期表示
renderTabs();
updateView();
