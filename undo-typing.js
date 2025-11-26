// undo-typing.js
// テキストエリアの「手入力」に対しても Undo スタックを積む拡張

(function () {
  // 入力が止まってから何ミリ秒で「1まとまり」とみなすか
  const TYPING_IDLE_MS = 1500;

  // kind ごとの状態管理
  const typingState = {
    pos:       { snapshot: null, dirty: false, timer: null },
    neg:       { snapshot: null, dirty: false, timer: null },
    presetPos: { snapshot: null, dirty: false, timer: null },
    presetNeg: { snapshot: null, dirty: false, timer: null },
  };

  /**
   * あるテキストエリアに「手入力 Undo」機能をセットアップ
   * @param {HTMLTextAreaElement} el
   * @param {"pos"|"neg"|"presetPos"|"presetNeg"} kind
   */
  function setupTypingUndo(el, kind) {
    if (!el) return;
    const state = typingState[kind];

    // フォーカスが当たったタイミングで「現在のテキスト」をスナップショットしておく
    el.addEventListener("focus", () => {
      if (typeof getTextByKind === "function") {
        state.snapshot = getTextByKind(kind); // 編集前のテキスト
      } else {
        state.snapshot = el.value;
      }
      state.dirty = false;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    });

    // 入力があるたびに呼ばれる
    el.addEventListener("input", () => {
      // app.js 側の input ハンドラが先に走ってテキストを更新したあとでここに来る

      // まだ今回の「入力まとまり」で Undo を積んでいない場合だけ一度だけ積む
      if (!state.dirty && state.snapshot != null && typeof pushUndo === "function") {
        // snapshot 時点（＝今回の編集を始める前）の状態を Undo に積む
        pushUndo(kind, state.snapshot);
        state.dirty = true;
      }

      // タイマーをリセットして、入力が止まったタイミングで「新しい安定状態」を snapshot にする
      if (state.timer) {
        clearTimeout(state.timer);
      }
      state.timer = setTimeout(() => {
        // 現在のテキストを「次の入力の起点」として記録
        if (typeof getTextByKind === "function") {
          state.snapshot = getTextByKind(kind);
        } else {
          state.snapshot = el.value;
        }
        state.dirty = false;
        state.timer = null;
      }, TYPING_IDLE_MS);
    });
  }

  // ページ読み込み完了後にセットアップ
  window.addEventListener("load", () => {
    // app.js 内で定義されたテキストエリア変数にフックする
    // （app.js が先に読み込まれている前提）
    try {
      if (typeof editorPosEl !== "undefined") {
        setupTypingUndo(editorPosEl, "pos");
      }
      if (typeof editorNegEl !== "undefined") {
        setupTypingUndo(editorNegEl, "neg");
      }
      if (typeof presetEditorPosEl !== "undefined") {
        setupTypingUndo(presetEditorPosEl, "presetPos");
      }
      if (typeof presetEditorNegEl !== "undefined") {
        setupTypingUndo(presetEditorNegEl, "presetNeg");
      }
    } catch (e) {
      console.warn("undo-typing.js setup error:", e);
    }
  });
})();
