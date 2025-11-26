// undo-typing.js
// テキストエリアの「手入力」にも Undo を対応させるスクリプト
// ※ app.js より後に読み込むこと前提

(function () {
  // app.js がまだ読まれていない場合は何もしない
  if (typeof pushUndo !== "function") {
    console.warn("undo-typing.js: pushUndo が見つからないので何もしません。");
    return;
  }

  // 対象となるテキストエリアを取得
  const editorPosEl        = document.getElementById("editorPos");
  const editorNegEl        = document.getElementById("editorNeg");
  const presetEditorPosEl  = document.getElementById("presetEditorPos");
  const presetEditorNegEl  = document.getElementById("presetEditorNeg");

  // それぞれのテキストエリアごとに「最後に記録した値」を持っておく
  const lastValues = {
    pos:        editorPosEl       ? editorPosEl.value       : "",
    neg:        editorNegEl       ? editorNegEl.value       : "",
    presetPos:  presetEditorPosEl ? presetEditorPosEl.value : "",
    presetNeg:  presetEditorNegEl ? presetEditorNegEl.value : ""
  };

  /**
   * テキストエリア1つに Undo 用の入力監視を設定
   * @param {"pos"|"neg"|"presetPos"|"presetNeg"} kind
   * @param {HTMLTextAreaElement|null} el
   */
  function setupUndoForEditor(kind, el) {
    if (!el) return; // 要素がなければ何もしない

    el.addEventListener("input", () => {
      const prev = lastValues[kind];
      const current = el.value;

      // 値が変化していなければ何もしない
      if (prev === current) return;

      // 一つ前の状態を Undo に積む
      pushUndo(kind, prev);

      // いまの内容を「最新状態」として覚えておく
      lastValues[kind] = current;
    });
  }

  // 各テキストエリアに設定
  setupUndoForEditor("pos",        editorPosEl);
  setupUndoForEditor("neg",        editorNegEl);
  setupUndoForEditor("presetPos",  presetEditorPosEl);
  setupUndoForEditor("presetNeg",  presetEditorNegEl);

  console.log("undo-typing.js: 手入力用 Undo 監視を設定しました。");
})();
