'use strict';

// ============================================================
// Python実行
// ============================================================

/** セル単体を実行 */
async function runCell(id) {
  if (!pyodideReady) {
    showModal({
      title: 'もう少しお待ちください',
      message: 'Python環境がまだ準備できていません。\n準備が終わってから実行してください。',
      okText: '閉じる', cancelText: null,
    });
    return;
  }
  if (isRunning) return;

  const cell = cells.find(c => c.id === id);
  if (!cell || cell.type !== 'code') return;

  // エディタの現在の内容を取得
  const code = editors[id] ? editors[id].getValue() : cell.content;
  if (!code.trim()) return;

  isRunning = true;
  showStopButton(true);   // ヘッダーに停止ボタンを表示

  // UI：実行中状態に切り替え
  const cellEl = document.querySelector(`[data-cell-id="${id}"]`);
  if (cellEl) cellEl.classList.add('running');
  const runBtn = document.getElementById(`run-btn-${id}`);
  if (runBtn) {
    // 実行中：スピナー（クルクル）を表示
    runBtn.innerHTML = '<svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg> 実行中';
    runBtn.disabled = true;
    runBtn.classList.remove('is-done');
  }

  renderOutput(id, { status: 'running' });

  const runId = ++runIdCounter;

  // 実行が1分を超えたら「停止しますか？」を確認する（ポップアップ表示だけでは停止しない）
  let longRunTimer = null;
  const armLongRunPrompt = () => {
    longRunTimer = setTimeout(async () => {
      // この実行がまだ走っているときだけ確認する
      if (!isRunning || !currentRun || currentRun.runId !== runId) return;
      const choice = await showModal({
        title: '実行が長引いています',
        message: 'セルの実行に時間がかかっています。\n停止しますか？',
        buttons: [
          { label: '停止する', value: 'stop',     variant: 'danger' },
          { label: '継続する', value: 'continue', variant: 'cancel' },
        ],
      });
      // モーダル操作中に実行が終わっている場合は何もしない
      if (!isRunning || !currentRun || currentRun.runId !== runId) return;
      if (choice === 'stop') stopExecution();
      else armLongRunPrompt(); // 継続：さらに1分後に再確認
    }, LONG_RUN_MS);
  };

  let result;
  try {
    // ワーカーに実行を依頼し、結果が返るまで待つ（メインスレッドはブロックしない）
    armLongRunPrompt();
    result = await new Promise((resolve) => {
      currentRun = {
        runId,
        resolve,
        onPkg: (m) => {
          // ライブラリのダウンロードが始まったら分かりやすく表示
          if (/loading/i.test(m)) {
            const names = (m.match(/Loading\s+(.+)/i) || [])[1] || '';
            renderOutput(id, { status: 'loading-pkg', packages: names });
          }
        }
      };
      pyWorker.postMessage({ type: 'run', runId, code });
    });
  } catch (err) {
    result = { status: 'done', errType: 'SystemError', errMsg: (err && err.message) || String(err), stdout: '', stderr: '', figs: [] };
  } finally {
    if (longRunTimer) clearTimeout(longRunTimer);
  }

  isRunning = false;
  showStopButton(false);
  if (cellEl) cellEl.classList.remove('running');

  // ボタンの表示を戻す
  const rb = document.getElementById(`run-btn-${id}`);
  if (rb) {
    rb.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg> 実行';
    rb.disabled = false;
  }

  if (result && result.stopped) {
    // 停止された場合：出力に「停止しました」を表示（実行済みにはしない）
    renderOutput(id, { status: 'stopped' });
    return result;
  }

  outputs[id] = result;
  renderOutput(id, result);
  if (rb) rb.classList.add('is-done');   // 実行完了：ボタンを薄く
  return result;
}

/** すべてのコードセルを順番に実行 */
async function runAllCells() {
  stopRequested = false;
  for (const cell of cells) {
    if (cell.type === 'code') {
      const r = await runCell(cell.id);
      if (r && r.stopped) break;   // 停止されたら中断
      await sleep(50);
    }
  }
}

/** すべての出力をクリア */
function clearAllOutputs() {
  cells.forEach(c => { delete outputs[c.id]; });
  document.querySelectorAll('.cell-output').forEach(el => { el.innerHTML = ''; });
}


// ============================================================
// 出力表示
// ============================================================
function renderOutput(id, result) {
  const el = document.getElementById(`output-${id}`);
  if (!el) return;

  if (result.status === 'running') {
    el.innerHTML = `
      <div class="output-running">
        <span class="spinner">⚙</span> 実行中...
      </div>`;
    return;
  }

  if (result.status === 'loading-pkg') {
    const names = result.packages ? escHtml(result.packages) : '';
    el.innerHTML = `
      <div class="output-running output-loading-pkg">
        <span class="spinner">⚙</span>
        <span>ライブラリを読み込み中…${names ? `（${names}）` : ''}</span>
        <small>初回はダウンロードのため少し時間がかかります（数十秒程度）</small>
      </div>`;
    return;
  }

  if (result.status === 'stopped') {
    el.innerHTML = `
      <div class="output-stopped">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        実行を停止しました（Python環境を再起動したため、変数はリセットされました）
      </div>`;
    return;
  }

  let html = '';

  // 実行済みマーク（このセルは実行された）— 出力が空でも表示する
  if (result.status === 'done') {
    const ranOk = !result.errMsg;
    html += `<div class="output-done-badge ${ranOk ? 'is-ok' : 'is-err'}">`
          + `<span class="done-check">${ranOk ? '✓' : '!'}</span> 実行済み</div>`;
  }

  // 標準出力
  if (result.stdout) {
    html += `<div class="output-text"><pre>${escHtml(result.stdout)}</pre></div>`;
  }

  // 警告（stderr）— Python の警告を日本語で分かりやすく表示する
  if (result.stderr) {
    html += renderWarnings(result.stderr);
  }

  // エラー
  if (result.errMsg) {
    const lineNum   = getErrorLineInfo(result.errTb);
    const codeLine  = getErrorCodeLine(result.errTb);
    const jaMsg     = translateError(result.errType, result.errMsg);
    const jaMsgHtml = escHtml(jaMsg).replace(/\n/g, '<br>');
    html += `
      <div class="output-error">
        <div class="error-header">
          <span class="error-type-badge">${escHtml(result.errType || 'Error')}</span>
          ${lineNum ? `<span class="error-line-badge">📍 ${lineNum}行目</span>` : ''}
        </div>
        <div class="error-message">${escHtml(result.errMsg)}</div>
        ${codeLine ? `<div class="error-code-line"><span class="error-code-label">該当:</span><code>${escHtml(codeLine)}</code></div>` : ''}
        <div class="error-japanese">${jaMsgHtml}</div>
        ${result.errTb ? `
          <details class="error-details">
            <summary>詳しいエラー情報を見る</summary>
            <pre>${escHtml(result.errTb)}</pre>
          </details>` : ''}
      </div>`;
  }

  // グラフ画像
  if (result.figs && result.figs.length > 0) {
    result.figs.forEach((b64, i) => {
      html += `
        <div class="output-figure">
          <img src="data:image/png;base64,${b64}" alt="グラフ ${i + 1}">
        </div>`;
    });
  }

  // DataFrame など _repr_html_() を持つオブジェクト（無害化してから表示）
  if (result.displayHtml) {
    html += `<div class="output-html">${sanitizeHtml(result.displayHtml)}</div>`;
  }

  // その他の値の text repr（数値・リスト・文字列など）
  if (result.lastDisplay && !result.displayHtml) {
    html += `<div class="output-text"><pre>${escHtml(result.lastDisplay)}</pre></div>`;
  }

  // 出力なしは何も表示しない（Jupyter と同じ挙動）
  el.innerHTML = html;
}

// ============================================================
// エラー行番号・コード行の抽出
// ============================================================

/** トレースバックから行番号を抽出（最後のセル内行を優先） */
function getErrorLineInfo(tb) {
  if (!tb) return null;
  const matches = [...tb.matchAll(/File "<セル>", line (\d+)/g)];
  if (!matches.length) return null;
  return matches[matches.length - 1][1];
}

/** トレースバックからエラーが起きたコード行を抽出 */
function getErrorCodeLine(tb) {
  if (!tb) return null;
  // 通常エラー: File "<セル>", line N, in ...\n    code
  // SyntaxError: File "<セル>", line N\n    code
  const m = tb.match(/File "<セル>", line \d+(?:, in [^\n]*)?\n([ \t]+)([^\n]+)\n/);
  if (!m) return null;
  const line = m[2].trim();
  // ハット記号だけの行は除外
  if (/^[\^~\s]+$/.test(line)) return null;
  return line.length > 80 ? line.slice(0, 77) + '...' : line;
}

// ============================================================
// エラーメッセージの日本語化（初学者向け詳細ガイド）
// ============================================================
function translateError(type, msg) {
  const rules = [

    // ======================================================
    // SyntaxError ─ 文法エラー
    // ======================================================
    { types: ['SyntaxError'],
      pattern: /expected ':'/,
      build: () => 'コロン「:」が必要です。\nif・for・while・def・class などの行の末尾には必ず「:」を付けてください。\n例（誤）: if x > 0\n例（正）: if x > 0:' },

    { types: ['SyntaxError'],
      pattern: /EOL while scanning string literal/,
      build: () => '文字列が閉じられていません。\nクォート「\'」または「"」を最後に書き忘れていませんか？\n例（誤）: print("こんにちは\n例（正）: print("こんにちは")' },

    { types: ['SyntaxError'],
      pattern: /EOF while scanning triple-quoted string literal/,
      build: () => '三重クォート（"""または\'\'\'）が閉じられていません。\n開いた """ や \'\'\' の終わりを書き忘れていませんか？' },

    { types: ['SyntaxError'],
      pattern: /unexpected EOF|unexpected end of file/i,
      build: () => 'コードが途中で終わっています。\n括弧 ()・[]・{} が閉じられているか確認してください。' },

    { types: ['SyntaxError'],
      pattern: /'(.+?)' was never closed|was never closed/,
      build: m => `括弧「${m[1] || '('}」が閉じられていません。\n開いた括弧の数と閉じた括弧の数が一致しているか確認してください。` },

    { types: ['SyntaxError'],
      pattern: /'return' outside function/,
      build: () => '「return」が関数の外にあります。\nreturn は def で定義した関数の中でのみ使えます。' },

    { types: ['SyntaxError'],
      pattern: /'break' outside loop/,
      build: () => '「break」が繰り返し（for・while）の外にあります。\nbreak は for や while の中でのみ使えます。' },

    { types: ['SyntaxError'],
      pattern: /'continue' outside loop/,
      build: () => '「continue」が繰り返し（for・while）の外にあります。\ncontinue は for や while の中でのみ使えます。' },

    { types: ['SyntaxError'],
      pattern: /cannot assign to (literal|expression here|operator|function call)/,
      build: () => '代入できない場所に「=」が使われています。\n• 条件式で「==」とすべき所を「=」と書いていませんか？\n• 数値や文字列リテラルに代入しようとしていませんか？\n例（誤）: if x = 5:  →  例（正）: if x == 5:' },

    { types: ['SyntaxError'],
      pattern: /f-string: empty expression not allowed/,
      build: () => 'f文字列の { } の中が空です。\n{ } の中には変数名や式を書いてください。\n例（誤）: f"値は{}"  →  例（正）: f"値は{x}"' },

    { types: ['SyntaxError'],
      pattern: /f-string/i,
      build: () => 'f文字列（f"..."）の書き方が間違っています。\n• { } の中に正しいPythonの式を書いてください\n• { } の対応が取れているか確認してください\n例（正）: f"こんにちは、{name}さん！"' },

    { types: ['SyntaxError'],
      pattern: /invalid character '(.+?)'/,
      build: m => `使えない文字「${m[1]}」が含まれています。\n全角の記号や日本語スペースが混じっていませんか？\n括弧・コロン・イコールなどの記号は必ず半角（ASCII）で入力してください。\n例: （→(   ：→:   ＝→=` },

    { types: ['SyntaxError'],
      pattern: /non-default argument follows default argument/,
      build: () => '関数の引数の定義が間違っています。\nデフォルト値（= で指定）のある引数の後に、デフォルト値のない引数は書けません。\n例（誤）: def f(a=1, b):\n例（正）: def f(b, a=1):' },

    { types: ['SyntaxError'],
      pattern: /positional argument follows keyword argument/,
      build: () => '関数の引数の渡し方が間違っています。\nキーワード引数（名前=値）の後に通常の引数（値のみ）は書けません。\n例（誤）: func(x=1, 2)  →  例（正）: func(2, x=1)' },

    { types: ['SyntaxError'],
      pattern: /duplicate argument '(.+?)'/,
      build: m => `関数の引数「${m[1]}」が重複しています。\n同じ名前の引数を2回書いています。引数名を変えてください。` },

    { types: ['SyntaxError'],
      pattern: /invalid decimal literal/,
      build: () => '数値の書き方が間違っています。\n変数名は数字で始めることができません。文字かアンダースコア(_)で始めてください。\n例（誤）: 1value = 10  →  例（正）: value1 = 10' },

    { types: ['SyntaxError'],
      pattern: /Missing parentheses in call to 'print'/,
      build: () => 'print の書き方が古い形式です。\nPython3 では print は ( ) で囲みます。\n例（誤）: print "こんにちは"\n例（正）: print("こんにちは")' },

    { types: ['SyntaxError'],
      pattern: /Missing parentheses in call to '(.+?)'/,
      build: m => `「${m[1]}」は ( ) で囲んで呼び出してください。\n例（正）: ${m[1]}("...")` },

    { types: ['SyntaxError'],
      pattern: /unterminated string literal/,
      build: () => '文字列が閉じられていません。\n行の終わりまでにクォート「\'」または「"」を書き忘れていませんか？\n例（誤）: name = "山田\n例（正）: name = "山田"' },

    { types: ['SyntaxError'],
      pattern: /unterminated triple-quoted string literal/,
      build: () => '三重クォート（"""または\'\'\'）が閉じられていません。\n開いた """ や \'\'\' の終わりを書き忘れていませんか？' },

    { types: ['SyntaxError'],
      pattern: /unmatched '(.+?)'/,
      build: m => `閉じ括弧「${m[1]}」に対応する開き括弧がありません。\n余分な括弧を書いていないか、開き括弧を書き忘れていないか確認してください。` },

    { types: ['SyntaxError'],
      pattern: /closing parenthesis '(.+?)' does not match opening parenthesis '(.+?)'/,
      build: m => `括弧の種類が合っていません。「${m[2]}」で開いたのに「${m[1]}」で閉じています。\n() [] {} の種類をそろえてください。` },

    { types: ['SyntaxError'],
      pattern: /Perhaps you forgot a comma/,
      build: () => 'カンマ「,」を書き忘れていませんか？\nリストや関数の引数では、要素どうしをカンマで区切ります。\n例（誤）: [1 2 3]  →  例（正）: [1, 2, 3]' },

    { types: ['SyntaxError'],
      pattern: /Maybe you meant '==' or ':=' instead of '='\?|cannot assign to .* maybe you meant/,
      build: () => '比較のつもりで「=」を使っていませんか？\n「等しいか」を調べるときは「==」を使います。\n例（誤）: if x = 5:  →  例（正）: if x == 5:' },

    { types: ['SyntaxError'],
      pattern: /keyword argument repeated/,
      build: () => '関数に同じキーワード引数を2回渡しています。\n同じ名前の引数を重複して指定していないか確認してください。' },

    { types: ['SyntaxError'],
      pattern: /invalid syntax/,
      build: () => '文法（書き方）が間違っています。よくある原因:\n• コロン「:」の付け忘れ（if・for・while・def の行末）\n• 括弧 ()・[]・{} の対応ミス\n• クォート「\'」「"」の対応ミス\n• 全角文字（記号・スペース）の混入\n• 比較に「==」ではなく「=」を使っている' },

    // ======================================================
    // IndentationError / TabError ─ インデントエラー
    // ======================================================
    { types: ['IndentationError'],
      pattern: /unexpected indent/,
      build: () => '余分なインデント（字下げ）があります。\nインデントが必要ない行に余分なスペースやタブが入っています。\n行の先頭の空白を確認してください。' },

    { types: ['IndentationError'],
      pattern: /expected an indented block/,
      build: () => 'インデント（字下げ）が必要です。\nif・for・while・def・class の次の行は必ずスペース4つで字下げしてください。\n例:\nif x > 0:\n    print("正の数")  ← スペース4つ必須' },

    { types: ['IndentationError'],
      pattern: /unindent does not match any outer indentation level/,
      build: () => '字下げの幅がそろっていません。\n前の行と字下げの位置が合っていません。\n同じブロックの中はすべて同じスペース数（4つ）にそろえてください。' },

    { types: ['IndentationError', 'TabError'],
      pattern: /inconsistent use of tabs and spaces/,
      build: () => 'タブ（Tab）とスペースが混在しています。\nインデントはスペース4つだけで統一してください。\nタブキーを使っている行をすべてスペース4つに変換しましょう。' },

    { types: ['IndentationError', 'TabError'],
      pattern: /.*/,
      build: () => 'インデント（字下げ）が正しくありません。\n• if・for・while・def・class の次の行はスペース4つで字下げ\n• タブとスペースを混在させない\n• 同じブロック内はすべて同じ字下げ幅にする' },

    // ======================================================
    // NameError ─ 未定義の名前
    // ======================================================
    { types: ['NameError'],
      pattern: /name '(.+?)' is not defined/,
      build: m => {
        const name = m[1];
        let hint = '';
        if (name === 'Print' || name === 'PRINT')       hint = '\nヒント: print は全部小文字です → print()';
        else if (name === 'Input' || name === 'INPUT')  hint = '\nヒント: input は全部小文字です → input()';
        else if (name === 'true' || name === 'false')   hint = `\nヒント: Python では先頭だけ大文字にします → ${name[0].toUpperCase() + name.slice(1)}`;
        else if (name === 'null' || name === 'nil')     hint = '\nヒント: Python では「None」（大文字N）を使います';
        else if (name === 'AND' || name === 'OR' || name === 'NOT') hint = `\nヒント: Python では小文字で「${name.toLowerCase()}」と書きます`;
        else if (name === 'elif' || name === 'else')    hint = '';
        return `変数・関数「${name}」が定義されていません。${hint}\n• スペルミスがないか確認してください\n• この変数を定義しているセルを先に実行しましたか？\n• import が必要なライブラリの関数ではありませんか？`;
      }
    },

    // ======================================================
    // UnboundLocalError ─ スコープエラー
    // ======================================================
    { types: ['UnboundLocalError'],
      pattern: /local variable '(.+?)' referenced before assignment/,
      build: m => `関数の中でローカル変数「${m[1]}」を定義する前に使っています。\n関数の外に同じ名前の変数があっても、関数の中で代入（=）すると「ローカル変数」扱いになります。\n関数内で使う前に必ず値を代入してください。\n外の変数を使いたい場合は「global ${m[1]}」と宣言する方法もあります。` },

    // ======================================================
    // TypeError ─ 型エラー
    // ======================================================
    { types: ['TypeError'],
      pattern: /unsupported operand type\(s\) for (.+?): '(.+?)' and '(.+?)'/,
      build: m => `「${m[2]}」型と「${m[3]}」型の間で「${m[1]}」の計算はできません。\n数値と文字列を混在させていませんか？\n• 数値に変換: int("3") または float("3.14")\n• 文字列に変換: str(42)\n例（誤）: 5 + "3"  →  例（正）: 5 + int("3")` },

    { types: ['TypeError'],
      pattern: /can only concatenate str \(not "(.+?)"\) to str/,
      build: m => `文字列（str）と「${m[1]}」型は「+」でつなげません。\nstr() で文字列に変換してください。\n例（誤）: "点数は" + 85\n例（正）: "点数は" + str(85)\n例（正）: f"点数は{85}"` },

    { types: ['TypeError'],
      pattern: /must be str, not (.+)/,
      build: m => `文字列が必要な場所に「${m[1]}」型が使われています。str() で文字列に変換してください。` },

    { types: ['TypeError'],
      pattern: /takes (\d+) positional arguments? but (\d+) (?:was|were) given/,
      build: m => `関数の引数の数が合いません。\nこの関数に渡せる引数は ${m[1]} 個ですが、${m[2]} 個渡されました。\n関数の定義（def 〜）と呼び出し方を確認してください。` },

    { types: ['TypeError'],
      pattern: /missing (\d+) required positional argument[s]?[: ]*'(.+?)'/,
      build: m => `関数の必須引数「${m[2]}」が渡されていません。\n（${m[1]} 個の引数が不足しています）` },

    { types: ['TypeError'],
      pattern: /missing (\d+) required positional argument/,
      build: m => `関数に必須の引数が ${m[1]} 個不足しています。\n関数を呼び出すときの引数を確認してください。` },

    { types: ['TypeError'],
      pattern: /got an unexpected keyword argument '(.+?)'/,
      build: m => `関数に「${m[1]}」というキーワード引数はありません。\n引数名のスペルを確認してください。` },

    { types: ['TypeError'],
      pattern: /got multiple values for argument '(.+?)'/,
      build: m => `関数の引数「${m[1]}」に値が2回渡されています。\n位置引数とキーワード引数で同じ引数を指定していませんか？` },

    { types: ['TypeError'],
      pattern: /'NoneType' object is not iterable/,
      build: () => 'None（何もない値）に対して繰り返し処理をしようとしました。\n• 関数が return で値を返しているか確認してください\n• 変数に意図せず None が入っていませんか？\n• for文の対象が None になっていませんか？' },

    { types: ['TypeError'],
      pattern: /'(.+?)' object is not iterable/,
      build: m => `「${m[1]}」型は繰り返し処理（for文など）には使えません。\nfor文にはリスト・range・str・tuple など繰り返せるものを使ってください。\n例（誤）: for i in 5:\n例（正）: for i in range(5):` },

    { types: ['TypeError'],
      pattern: /'(.+?)' object is not subscriptable/,
      build: m => `「${m[1]}」型には [ ] でアクセスできません。\nリスト・文字列・辞書など、インデックスが使えるデータ型か確認してください。` },

    { types: ['TypeError'],
      pattern: /'(.+?)' object is not callable/,
      build: m => `「${m[1]}」は関数ではないため、() で呼び出すことはできません。\n変数名と組み込み関数名が同じになっていませんか？\n例: list = [1,2,3] とした後に list() を呼ぶとこのエラーが出ます。` },

    { types: ['TypeError'],
      pattern: /object of type '(.+?)' has no len\(\)/,
      build: m => `「${m[1]}」型には len() が使えません。\nlen() はリスト・文字列・タプルなど、長さを持つデータ型に使います。` },

    { types: ['TypeError'],
      pattern: /'str' object cannot be interpreted as an integer/,
      build: () => '整数が必要な場所に文字列が使われています。int() で整数に変換してください。\n例（誤）: range("5")  →  例（正）: range(5)' },

    { types: ['TypeError'],
      pattern: /'(.+?)' object cannot be interpreted as an integer/,
      build: m => `整数が必要な場所に「${m[1]}」型が使われています。\nrange() などには整数を渡してください。小数なら int() で変換します。\n例（誤）: range(3.0)  →  例（正）: range(3)` },

    { types: ['TypeError'],
      pattern: /'[<>]=?' not supported between instances of '(.+?)' and '(.+?)'/,
      build: m => `「${m[1]}」型と「${m[2]}」型は大小を比べられません。\n数値どうし、または文字列どうしで比較してください。\n文字列の数字は int() で数値に変換しましょう。\n例（誤）: "5" > 3  →  例（正）: int("5") > 3` },

    { types: ['TypeError'],
      pattern: /can't multiply sequence by non-int of type '(.+?)'/,
      build: m => `文字列やリストは「${m[1]}」型ではかけられません。\n繰り返しに使う回数は整数（int）にしてください。\n例（誤）: "ab" * 2.5  →  例（正）: "ab" * 2` },

    { types: ['TypeError'],
      pattern: /sequence item \d+: expected str instance, (.+?) found/,
      build: m => `"".join() でつなげられるのは文字列だけです。リストの中に「${m[1]}」型が混ざっています。\n数値が含まれる場合は文字列に変換してください。\n例: "-".join(str(x) for x in [1, 2, 3])` },

    { types: ['TypeError'],
      pattern: /argument of type '(.+?)' is not iterable/,
      build: m => `「${m[1]}」型に対して「in」で中身を探すことはできません。\n「in」はリスト・文字列・辞書などに使います。` },

    { types: ['TypeError'],
      pattern: /string indices must be integers/,
      build: () => '文字列に [ ] でアクセスするときは整数の番号を使います。\n文字列は辞書のように [ "キー" ] ではアクセスできません。\n例（誤）: s["a"]  →  例（正）: s[0]' },

    { types: ['TypeError'],
      pattern: /list indices must be integers or slices, not (.+)/,
      build: m => `リストの [ ] には整数の番号を入れてください（「${m[1]}」型は使えません）。\n例（誤）: lst["0"]  →  例（正）: lst[0]` },

    { types: ['TypeError'],
      pattern: /(.+?)\(\) takes no arguments/,
      build: m => `「${m[1]}」は引数を受け取りません。( ) の中に値を入れずに呼び出してください。` },

    { types: ['TypeError'],
      pattern: /.*/,
      build: () => 'データの型（種類）が合っていません。\ntype() でデータの型を確認し、int()・float()・str() などで変換してみましょう。' },

    // ======================================================
    // IndexError ─ インデックスエラー
    // ======================================================
    { types: ['IndexError'],
      pattern: /list index out of range/,
      build: () => 'リストの範囲外にアクセスしようとしました。\n• 最初の要素は [0]、最後の要素は [-1] です\n• インデックスは 0 ～ len(リスト)-1 の範囲にしてください\n例: lst = [10,20,30] の場合 → lst[0]=10, lst[1]=20, lst[2]=30, lst[3]はエラー！' },

    { types: ['IndexError'],
      pattern: /string index out of range/,
      build: () => '文字列の範囲外にアクセスしようとしました。\nインデックスが文字列の長さを超えています。len() で長さを確認してください。' },

    { types: ['IndexError'],
      pattern: /tuple index out of range/,
      build: () => 'タプルの範囲外にアクセスしようとしました。\nインデックスがタプルの要素数を超えています。' },

    { types: ['IndexError'],
      pattern: /index (\d+) is out of bounds for axis \d+ with size (\d+)/,
      build: m => `NumPy配列のインデックス ${m[1]} が範囲外です（サイズは ${m[2]}）。\n.shape で配列の形を確認してください。` },

    { types: ['IndexError'],
      pattern: /.*/,
      build: () => 'リスト・配列の範囲外にアクセスしました。\nインデックスの値が大きすぎます。len() で長さを確認してください。' },

    // ======================================================
    // KeyError ─ 辞書のキーエラー
    // ======================================================
    { types: ['KeyError'],
      pattern: /(.+)/,
      build: m => `辞書（dict）にキー ${m[1]} が存在しません。\n• キーのスペルを確認してください\n• .get(キー) を使うと存在しないキーでもエラーにならず None を返します\n• dict.keys() でキーの一覧を確認できます` },

    // ======================================================
    // ZeroDivisionError ─ ゼロ除算
    // ======================================================
    { types: ['ZeroDivisionError'],
      pattern: /.*/,
      build: () => '0（ゼロ）で割り算しようとしました。\n分母（割る数）が 0 になっていないか確認してください。\n割る前に if 文でゼロチェックするとよいでしょう。\n例: if b != 0: print(a / b)' },

    // ======================================================
    // ImportError / ModuleNotFoundError ─ インポートエラー
    // ======================================================
    { types: ['ImportError', 'ModuleNotFoundError'],
      pattern: /No module named '(.+?)'/,
      build: m => `ライブラリ「${m[1]}」が見つかりません。\n使える主なライブラリ: numpy, pandas, matplotlib, sklearn, scipy, PIL, math, random, json, re, datetime\nimport のスペルを確認してください。` },

    { types: ['ImportError'],
      pattern: /cannot import name '(.+?)' from '(.+?)'/,
      build: m => `モジュール「${m[2]}」に「${m[1]}」という名前はありません。\nスペルを確認してください。` },

    { types: ['ImportError', 'ModuleNotFoundError'],
      pattern: /.*/,
      build: () => 'ライブラリのインポートに失敗しました。\nライブラリ名のスペルを確認してください。' },

    // ======================================================
    // AttributeError ─ 属性エラー
    // ======================================================
    { types: ['AttributeError'],
      pattern: /'NoneType' object has no attribute '(.+?)'/,
      build: m => `None（何もない値）に「.${m[1]}」を使おうとしました。\n• 変数に None が入っていませんか？\n• 関数が値を return しているか確認してください\n• メソッドの戻り値を変数に受けた後に使おうとしていませんか？\n例: x = リスト.sort() → sort() は None を返すので x は None になります！` },

    { types: ['AttributeError'],
      pattern: /'(.+?)' object has no attribute '(.+?)'/,
      build: m => `「${m[1]}」型のオブジェクトに「${m[2]}」という属性・メソッドはありません。\n• スペルミスがないか確認してください\n• データの型が想定と合っているか type() で確認してください` },

    { types: ['AttributeError'],
      pattern: /module '(.+?)' has no attribute '(.+?)'/,
      build: m => `モジュール「${m[1]}」に「${m[2]}」という関数・属性はありません。\nスペルミスがないか確認してください。` },

    { types: ['AttributeError'],
      pattern: /.*/,
      build: () => '属性またはメソッドが見つかりません。\nスペルミスや、データの型の間違いがないか確認してください。' },

    // ======================================================
    // ValueError ─ 値エラー
    // ======================================================
    { types: ['ValueError'],
      pattern: /invalid literal for int\(\) with base \d+: '(.+?)'/,
      build: m => `「${m[1]}」を整数に変換できません。\nint() には数字だけからなる文字列を渡してください。\n小数を整数にしたい場合: int(float("3.14"))\n例（誤）: int("abc")  例（誤）: int("3.14")  例（正）: int("42")` },

    { types: ['ValueError'],
      pattern: /invalid literal for int\(\)/,
      build: () => '文字列を整数に変換できません。\nint() には数字だけからなる文字列を渡してください。\n例（誤）: int("abc")  →  例（正）: int("42")' },

    { types: ['ValueError'],
      pattern: /could not convert string to float: '(.+?)'/,
      build: m => `「${m[1]}」を小数（float）に変換できません。\n数値のみの文字列か確認してください。` },

    { types: ['ValueError'],
      pattern: /could not convert string to float/,
      build: () => '文字列を小数（float）に変換できません。\n数値のみの文字列か確認してください。' },

    { types: ['ValueError'],
      pattern: /too many values to unpack \(expected (\d+)\)/,
      build: m => `展開する値が多すぎます。\n左辺に ${m[1]} 個の変数がありますが、右辺の要素数がそれより多いです。\n例（誤）: a, b = [1, 2, 3]\n例（正）: a, b, c = [1, 2, 3]` },

    { types: ['ValueError'],
      pattern: /too many values to unpack/,
      build: () => '展開する値が多すぎます。左辺の変数の数と右辺の要素の数を合わせてください。' },

    { types: ['ValueError'],
      pattern: /not enough values to unpack \(expected (\d+), got (\d+)\)/,
      build: m => `展開する値が少なすぎます。\n左辺に ${m[1]} 個の変数がありますが、右辺の要素は ${m[2]} 個しかありません。` },

    { types: ['ValueError'],
      pattern: /not enough values to unpack/,
      build: () => '展開する値が少なすぎます。左辺の変数の数と右辺の要素の数を合わせてください。' },

    { types: ['ValueError'],
      pattern: /math domain error/,
      build: () => '数学的に定義できない計算をしようとしました。\n• 負の数の平方根: math.sqrt(-1) はエラー\n• 0の対数: math.log(0) はエラー\n入力値を確認してください。' },

    { types: ['ValueError'],
      pattern: /(max|min)\(\) (?:arg is an empty sequence|iterable argument is empty)/,
      build: m => `${m[1]}() に空のリストを渡しています。\n中身のあるリストを渡してください。\n先に len(リスト) で要素があるか確認するとよいでしょう。` },

    { types: ['ValueError'],
      pattern: /empty separator/,
      build: () => 'split() の区切り文字に空の文字列を指定しています。\n区切りたい文字（例: "," や " "）を指定してください。' },

    { types: ['ValueError'],
      pattern: /operands could not be broadcast together with shapes?/,
      build: () => 'NumPy配列の形（shape）が合いません。\n計算する配列のサイズが一致しているか .shape で確認してください。' },

    { types: ['ValueError'],
      pattern: /setting an array element with a sequence/,
      build: () => 'NumPy配列に形の揃わないデータを入れようとしました。\n各行の要素数が同じかどうか確認してください。' },

    { types: ['ValueError'],
      pattern: /x and y must be the same size/,
      build: () => 'グラフのx軸とy軸のデータ数が一致しません。\n同じ長さのリスト・配列を使ってください。len() で両方の長さを確認しましょう。' },

    { types: ['ValueError'],
      pattern: /list\.remove\(x\): x not in list/,
      build: () => 'remove() で削除しようとした値がリストの中にありません。\n値のスペルや型（文字列か数値か）を確認してください。' },

    { types: ['ValueError'],
      pattern: /substring not found/,
      build: () => 'index() で探した文字列が見つかりませんでした。\nfind() を使うと見つからない場合も -1 を返してエラーになりません。' },

    { types: ['ValueError'],
      pattern: /.*/,
      build: () => '値が正しくありません。\nデータの内容・形式・範囲を確認してください。' },

    // ======================================================
    // RecursionError ─ 再帰エラー
    // ======================================================
    { types: ['RecursionError'],
      pattern: /.*/,
      build: () => '関数の呼び出しが深くなりすぎました（再帰が無限ループになっています）。\n再帰関数には必ず「終了条件（ベースケース）」を書いてください。\n例: if n == 0: return 1  のような処理で再帰を止めましょう。' },

    // ======================================================
    // OverflowError ─ オーバーフロー
    // ======================================================
    { types: ['OverflowError'],
      pattern: /.*/,
      build: () => '数値が大きすぎて処理できません。\n計算の途中で非常に大きな数（無限大）になっていませんか？\nmath.inf や float("inf") と比較して確認できます。' },

    // ======================================================
    // MemoryError ─ メモリ不足
    // ======================================================
    { types: ['MemoryError'],
      pattern: /.*/,
      build: () => 'メモリが不足しています。\n非常に大きなリストや配列を作ろうとしていませんか？\nより小さなデータで試してみてください。' },

    // ======================================================
    // FileNotFoundError / OSError ─ ファイルエラー
    // ======================================================
    { types: ['FileNotFoundError'],
      pattern: /.*/,
      build: () => 'ファイルが見つかりません。\nこのノートブック（ブラウザ上のPython）ではローカルファイルの読み書きはできません。\nファイルの代わりに直接データをコードに書いて使ってください。' },

    { types: ['OSError', 'IOError'],
      pattern: /.*/,
      build: () => 'ファイルやシステム操作でエラーが発生しました。\nこのノートブックではファイルへのアクセスは制限されています。' },

    { types: ['PermissionError'],
      pattern: /.*/,
      build: () => 'アクセス権限がありません。\nこのノートブックではファイルやシステムへのアクセスは制限されています。' },

    // ======================================================
    // AssertionError ─ アサーションエラー
    // ======================================================
    { types: ['AssertionError'],
      pattern: /.*/,
      build: () => 'assert 文の条件が満たされませんでした。\nデバッグ・テスト用の検証が失敗しています。条件式を確認してください。' },

    // ======================================================
    // RuntimeError ─ 実行時エラー
    // ======================================================
    { types: ['RuntimeError'],
      pattern: /dictionary changed size during iteration/,
      build: () => 'for文でループ中に辞書（dict）の要素を追加・削除しようとしました。\nループ前にコピーを作ってから操作してください。\n例: for k in list(d.keys()):' },

    { types: ['RuntimeError'],
      pattern: /.*/,
      build: () => '実行時エラーが発生しました。\nコードの論理を見直してみてください。' },

    // ======================================================
    // SystemExit / StopIteration / UnicodeError
    // ======================================================
    { types: ['SystemExit'],
      pattern: /.*/,
      build: () => 'プログラムが sys.exit() によって終了しました。\n意図した終了か確認してください。' },

    { types: ['StopIteration'],
      pattern: /.*/,
      build: () => 'イテレータの要素がなくなりました。\nnext() を使いすぎていませんか？for文を使うとより安全です。' },

    { types: ['UnicodeDecodeError', 'UnicodeEncodeError'],
      pattern: /.*/,
      build: () => '文字コードのエラーです。\n日本語などの特殊文字の処理で起こることがあります。' },

    { types: ['TimeoutError'],
      pattern: /.*/,
      build: () => '処理が時間切れになりました。\n無限ループや重い計算になっていないか確認してください。' },
  ];

  for (const rule of rules) {
    if (rule.types.includes(type)) {
      const m = msg ? msg.match(rule.pattern) : null;
      if (m) return rule.build(m);
    }
  }

  return 'エラーが発生しました。\nエラーメッセージをよく読んで、コードを確認してみましょう。\nわからなければ先生や友達に聞いてみよう！';
}

// ============================================================
// 警告（Warning）の日本語化
// ============================================================

/**
 * stderr に出力された Python の警告を解析し、日本語ヒント付きで表示するHTMLを返す。
 * 警告でない通常の stderr 出力はそのまま表示する。
 */
function renderWarnings(stderr) {
  if (!stderr) return '';
  // 「<ファイル>:行: 種別Warning: メッセージ」形式の警告を1件ずつ取り出す
  const warnRe = /^(.*?):(\d+):\s*([A-Za-z_]*Warning):\s*(.+)$/;
  const lines = stderr.split('\n');
  const warnings = [];
  let leftover = [];

  for (const line of lines) {
    const m = line.match(warnRe);
    if (m) {
      warnings.push({ line: m[2], type: m[3], message: m[4].trim() });
    } else if (line.trim() && !/^\s+\S/.test(line)) {
      // 警告に付随するソース行（インデント行）は無視、それ以外の出力は残す
      leftover.push(line);
    }
  }

  let html = '';
  for (const w of warnings) {
    const ja = translateWarning(w.type, w.message);
    const jaHtml = escHtml(ja).replace(/\n/g, '<br>');
    html += `
      <div class="output-warning">
        <div class="warning-header">
          <span class="warning-type-badge">⚠ ${escHtml(w.type)}</span>
          ${w.line ? `<span class="warning-line-badge">📍 ${w.line}行目</span>` : ''}
        </div>
        <div class="warning-message">${escHtml(w.message)}</div>
        <div class="warning-japanese">${jaHtml}</div>
      </div>`;
  }

  // 警告として解析できなかった stderr 出力（あれば）はそのまま表示
  const rest = leftover.join('\n').trim();
  if (rest) {
    html += `<div class="output-warning"><pre>${escHtml(rest)}</pre></div>`;
  }
  return html;
}

/** 警告メッセージを初学者向けの日本語ヒントに変換する */
function translateWarning(type, msg) {
  const rules = [

    // ── matplotlib 関連 ──────────────────────────────
    { pattern: /Matplotlib is currently using agg|non-GUI backend|cannot show the figure/,
      build: () => 'これは問題ありません。\nplt.show() による画面表示はできませんが、グラフはこのセルのすぐ下に自動で表示されます。そのまま進めて大丈夫です。' },

    { pattern: /Glyph \d+ .*missing from (the )?(current )?font|missing from font|findfont: .*not found/,
      build: () => 'グラフの中の一部の文字（日本語など）が表示できませんでした。\nグラフのラベルやタイトルを英語（半角英数字）にすると、文字化け（□表示）を防げます。' },

    { pattern: /More than 20 figures have been opened/,
      build: () => 'グラフを開きすぎています。\n使い終わったグラフは plt.close() で閉じるとメモリを節約できます。' },

    { pattern: /Tight layout not applied|tight_layout/,
      build: () => 'グラフのレイアウト自動調整がうまくできませんでした。\nグラフの表示自体には大きな影響はありません。' },

    { pattern: /FixedFormatter should only be used together with FixedLocator/,
      build: () => '軸ラベルの設定方法に関する警告です。\nset_xticks() で目盛りを決めてから set_xticklabels() を使うと安全です。表示への影響は小さいです。' },

    // ── NumPy の計算に関する RuntimeWarning ───────────
    { pattern: /divide by zero encountered/,
      build: () => '0（ゼロ）で割り算が行われました（結果は inf＝無限大になります）。\n分母が0になっていないか確認してください。' },

    { pattern: /invalid value encountered/,
      build: () => '計算の結果が NaN（非数：数として表せない値）になりました。\n「0 ÷ 0」や「負の数の平方根」などが原因のことがあります。データの値を確認してください。' },

    { pattern: /overflow encountered/,
      build: () => '数値が大きくなりすぎました（オーバーフロー）。\n扱う数値の大きさや、計算式を確認してください。' },

    { pattern: /Mean of empty slice|Degrees of freedom <= 0/,
      build: () => '空（から）のデータに対して平均や標準偏差を計算しようとしました。\nデータが空になっていないか、len() で確認してください。' },

    // ── scikit-learn 関連 ────────────────────────────
    { pattern: /did not converge|failed to converge|ConvergenceWarning|Maximum number of iteration/i,
      build: () => '学習（最適化）が指定回数内に終わりきりませんでした。\nmax_iter（繰り返し回数）を増やすか、データを標準化（StandardScaler）すると改善することがあります。多くの場合そのまま使っても問題ありません。' },

    { pattern: /does not have valid feature names|X has feature names|X does not have valid feature names/,
      build: () => '学習したときと予測するときで、データの形式（列名の有無）が少し違っています。\n動作はしますが、同じ形式（例：どちらも DataFrame）にそろえると安全です。' },

    // ── pandas 関連 ──────────────────────────────────
    { pattern: /A value is trying to be set on a copy of a slice|SettingWithCopyWarning/,
      build: () => 'データフレームの一部に直接値を入れようとしています。\n意図せず元のデータが変わらないことがあります。df.loc[行, 列] = 値 の形で書くと安全です。' },

    { pattern: /np\.(float|int|bool|object|str)`? is a deprecated alias|`np\.\w+` is a deprecated/,
      build: () => 'np.float などの古い書き方は廃止されました。\nfloat や int など、通常の型名をそのまま使ってください。' },

    // ── 警告の種別ごとの汎用ヒント ───────────────────
    { pattern: /^/, when: t => t === 'DeprecationWarning' || t === 'PendingDeprecationWarning',
      build: () => 'この機能は将来のバージョンで廃止される予定です。\n今は問題なく動きますが、新しい書き方が用意されている場合はそちらが推奨されます。' },

    { pattern: /^/, when: t => t === 'FutureWarning',
      build: () => '将来のバージョンで動作が変わる予定の機能です。\n今は問題なく動きますが、頭の片隅に置いておきましょう。' },

    { pattern: /^/, when: t => t === 'RuntimeWarning',
      build: () => '計算中の注意メッセージです（エラーではありません）。\n0での割り算や、NaN・無限大などが発生していないか、結果を確認してみましょう。' },

    { pattern: /^/, when: t => t === 'UserWarning',
      build: () => '注意メッセージ（警告）です。\nプログラムは動いていますが、内容を一度確認しておくとよいでしょう。' },
  ];

  for (const rule of rules) {
    if (rule.when && !rule.when(type)) continue;
    if (msg && rule.pattern.test(msg)) return rule.build();
    if (!msg && rule.pattern.source === '^') return rule.build();
  }

  return '警告メッセージです。\nエラーではないのでプログラムは動作していますが、内容を確認しておきましょう。';
}

// ============================================================
// ヘルプパネル
// ============================================================
function toggleHelp() {
  document.getElementById('help-panel').classList.toggle('hidden');
}

// ============================================================
// ユーティリティ
// ============================================================
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
