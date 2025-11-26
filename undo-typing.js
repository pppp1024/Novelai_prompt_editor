// undo-typing.js
// テキストエリアの「手入力」を Undo 対応させるスクリプト
// ※ app.js より後に読み込むこと前提

(function () {
  // app.js の undo 用関数がなければ何もしない
  if (typeof saveUndoBeforeChange !== "function") {
    console.warn("undo-typing.js: saveUndoBeforeChange が見つからないので何もしません。");
    return;
  }

  // 各エディタ要素を取得
  const editorPosEl       = document.getElementById("editorPos");
  const editorNegEl       = document.getElementById("editorNeg");
  const presetEditorPosEl = document.getElementById("presetEditorPos");
  const presetEditorNegEl = document.getElementById("presetEditorNeg");

  // 「このエディタで今の入力セッション中に、すでにスナップショットを積んだかどうか」
  const snapshotTaken = {
    pos: false,
    neg: false,
    presetPos: false,
    presetNeg: false
  };

  // 入力が止まったとみなす待ち時間（ミリ秒）
  const RESET_DELAY = 1000;
  const timers = {
    pos: null,
    neg: null,
    presetPos: null,
    presetNeg: null
  };

  function startTyping(kind) {
    // Ctrl や Cmd 系のショートカット（Ctrl+Z など）では積まない
    // ※ keydown ハンドラ側でチェックするのでここでは何もしない

    // まだこの入力セッションで Undo を積んでいなければ、ここで一度だけ積む
    if (!snapshotTaken[kind]) {
      saveUndoBeforeChange(kind);  // ← app.js 内の関数を呼ぶ
      snapshotTaken[kind] = true;
    }

    // 入力が続く間はタイマーを張り直し、止まったらフラグをリセット
    if (timers[kind]) {
      clearTimeout(timers[kind]);
    }
    timers[kind] = setTimeout(() => {
      snapshotTaken[kind] = false;
      timers[kind] = null;
    }, RESET_DELAY);
  }

  /**
   * 指定された textarea に keydown ハンドラを設定
   * @param {"pos"|"neg"|"presetPos"|"presetNeg"} kind
   * @param {HTMLTextAreaElement|null} el
   */
  function setupUndoTyping(kind, el) {
    if (!el) return;

    el.addEventListener("keydown", (e) => {
      // IME変換中の特殊キーやショートカットはなるべくスキップ
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      // 単なる修飾なしのキー入力っぽいものだけ拾う
      // （Enter / Backspace / 文字キーなど）
      startTyping(kind);
    });
  }

  setupUndoTyping("pos",       editorPosEl);
  setupUndoTyping("neg",       editorNegEl);
  setupUndoTyping("presetPos", presetEditorPosEl);
  setupUndoTyping("presetNeg", presetEditorNegEl);

  console.log("undo-typing.js: 手入力 Undo 対応を有効化しました。");
})();
