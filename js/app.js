/* ==================================================
   Pythonノートブック - アプリケーション本体
   高校生向けプログラミング環境
   ================================================== */

'use strict';

// ============================================================
// グローバル状態
// ============================================================
let pyodide = null;          // Pyodideインスタンス
let cells   = [];            // セルデータの配列
let nextId  = 0;             // セルIDカウンター
let editors = {};            // CodeMirrorインスタンス { id: editor }
let outputs = {};            // 実行結果キャッシュ    { id: result }
let isRunning = false;       // 実行中フラグ

// ライトボックス状態
let lbCellId = null;
let lbIdx    = 0;

// ============================================================
// 初期化
// ============================================================
// ページ読み込み時に自動起動
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  setProgress(5, 'Pyodideを読み込んでいます...');

  try {
    // Pyodide本体の読み込み
    pyodide = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/'
    });
    setProgress(40, '基本ライブラリ（numpy, pandas, matplotlib）を読み込んでいます...');

    // よく使うパッケージを先読み
    await pyodide.loadPackage(['numpy', 'pandas', 'matplotlib']);
    setProgress(80, 'Python実行環境を準備しています...');

    // Python実行環境のセットアップ
    await pyodide.runPythonAsync(PYTHON_SETUP_CODE);
    setProgress(100, '準備完了！');

    // 少し待ってからロード画面を消す
    await sleep(400);
    document.getElementById('loading-overlay').classList.add('hidden');

    // URL パラメータで分岐
    const params = new URLSearchParams(window.location.search);
    if (params.get('lesson')) {
      buildDefaultNotebook();              // ?lesson=xxx → レッスン直接ロード
    } else if (params.get('gdrive')) {
      await loadFromUrl(params.get('gdrive')); // ?gdrive=ID/URL → Drive直接ロード
    } else if (params.get('nb')) {
      await loadFromUrl(params.get('nb'));   // ?nb=URL → .ipynb 直接ロード（Colab/Drive可）
    } else {
      showWelcomeScreen();                 // パラメータなし → ウェルカム画面
    }

  } catch (err) {
    setProgress(0, `⚠ 読み込みエラー: ${err.message}`);
    console.error(err);
  }
}

function setProgress(pct, msg) {
  const bar = document.getElementById('loading-bar');
  const status = document.getElementById('loading-status');
  if (bar)    bar.style.width = pct + '%';
  if (status) status.textContent = msg;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
// Pythonセットアップコード
// ============================================================
const PYTHON_SETUP_CODE = `
import sys, io, base64, traceback, builtins, ast as _ast

# matplotlibを設定（画像として出力できるようにする）
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# 日本語フォントの設定（利用可能な場合）
try:
    from matplotlib import rcParams
    rcParams['font.family'] = 'DejaVu Sans'
    rcParams['axes.unicode_minus'] = False
except:
    pass

# 標準出力をキャプチャするクラス
class _CapIO:
    def __init__(self):
        self._buf = []
    def write(self, s):
        if s:
            self._buf.append(str(s))
    def flush(self):
        pass
    def getvalue(self):
        return ''.join(self._buf)

# ノートブック全体で共有される変数空間
_nb_globals = {}
exec("", _nb_globals)

print("✅ Python環境の準備ができました！")
`;

// ============================================================
// レッスン定義（URLパラメータ ?lesson=xxx で切り替え）
// ============================================================
const LESSONS = {

  // ─── デフォルト（パラメータなし） ───
  default: {
    title: 'Pythonノートブック',
    cells: () => [
      { type: 'text', content: `# PyHiroba（ぱいひろば）へようこそ！

PyHiroba は、ブラウザだけで Python（パイソン）プログラミングが学べる学習環境です。
インストールも、アカウント登録も不要です。さっそく始めてみましょう！

## 1. Python（パイソン）とは
Python は、世界中で使われている人気のプログラミング言語です。
読みやすくて初心者にもやさしく、AI・データ分析・Web など、いろいろな場面で活躍しています。

## 2. PyHiroba（ぱいひろば）とは
このPyHiroba は、その Python を簡単にブラウザ上で動かせるサービスです。
書いたコードはあなたのパソコンの中で動くので、安心して使えます。

## 3. PyHirobaの使い方
このノートブックは、2種類の「セル」でできています。

- **コードセル**：Python のプログラムを書く場所です。
  左の ▶ 実行 ボタン（または Shift + Enter）でプログラムを実行できます。
  上のセルで作った変数は下のセルでも使えるので、上から順番に実行しましょう。
- **テキストセル**：今読んでいるこの文章のような、説明を書く場所です。
  文字だけでなく、画像やスライドも入れられます。

## 4. キーボードショートカット
覚えておくと便利なキーです。

- **Shift + Enter** … セルを実行する
- **Ctrl + Z** … 直前の操作を取り消す（もとに戻す）

それでは、最初のプログラムを動かしてみましょう！
下のセルの **▶ 実行** を押してください。` },
      { type: 'code', content: `print("hello PyHiroba")` },
      { type: 'code', content: '# ここに自由にコードを書いてみよう！\n' },
    ]
  },

  // ─── lesson=basics : Python基礎 ───
  basics: {
    title: '第1回：Pythonの基本',
    cells: () => [
      { type: 'text', content: `# 📘 第1回：Pythonの基本

**今日のゴール：** 変数・計算・条件分岐・繰り返しを使えるようになろう！

> 各セルの **▶ 実行**（または **Shift+Enter**）でコードを動かせます。` },

      { type: 'text', content: `## 1. 変数と出力
変数とは「データに名前をつけて入れておく箱」のことです。` },
      { type: 'code', content: `# 変数に値を入れる
name  = "山田太郎"   # 文字列（str）
age   = 16           # 整数（int）
score = 85.5         # 小数（float）

# print() で表示する
print(name)
print(age)
print(score)

# f文字列で組み合わせる
print(f"{name}さんは{age}歳、点数は{score}点です。")` },

      { type: 'text', content: `## 2. 計算
Pythonは電卓として使えます。` },
      { type: 'code', content: `# 四則演算
print(10 + 3)   # 足し算
print(10 - 3)   # 引き算
print(10 * 3)   # 掛け算
print(10 / 3)   # 割り算（小数）
print(10 // 3)  # 割り算（整数）
print(10 % 3)   # あまり
print(10 ** 2)  # べき乗（10の2乗）` },

      { type: 'text', content: `## 3. 条件分岐（if文）
「もし〜なら」という処理を書きます。インデント（字下げ）が重要です！` },
      { type: 'code', content: `score = 75  # ← 数値を変えて試してみよう！

if score >= 80:
    print("合格！よくできました！")
elif score >= 60:
    print("もう少し！あと少しで合格です。")
else:
    print("残念…次は頑張ろう！")

print(f"あなたの点数: {score}点")` },

      { type: 'text', content: `## 4. 繰り返し（for文）
同じ処理を何度も繰り返します。` },
      { type: 'code', content: `# 1から10まで表示
for i in range(1, 11):
    print(f"{i} × 2 = {i * 2}")` },
      { type: 'code', content: `# リストの中身を1つずつ取り出す
fruits = ["りんご", "バナナ", "みかん", "ぶどう"]

for fruit in fruits:
    print("好きな果物：" + fruit)

print(f"\\n合計 {len(fruits)} 種類あります")` },

      { type: 'text', content: `## ✏️ 練習問題
1から100までの数のうち、3の倍数だけを表示してみよう！` },
      { type: 'code', content: `# ヒント: i % 3 == 0 で「3の倍数かどうか」を判定できる

for i in range(1, 101):
    pass  # ← ここを書き換えよう！` },
    ]
  },

  // ─── lesson=numpy : NumPy ───
  numpy: {
    title: '第2回：NumPyで数値計算',
    cells: () => [
      { type: 'text', content: `# 📗 第2回：NumPyで数値計算

**NumPy**（ナンパイ）は数値計算の定番ライブラリです。
大量のデータをまとめて高速に計算できます。

> まず下のセルを **▶ 実行** してみよう！` },

      { type: 'text', content: `## 1. 配列（array）を作る
NumPyの配列は、複数の数値をまとめて扱える「数字の列」です。` },
      { type: 'code', content: `import numpy as np

# 配列を作る
a = np.array([1, 2, 3, 4, 5])
print("配列 a:", a)
print("データ型:", a.dtype)
print("要素数:", len(a))

# 全部に同じ計算ができる！（Pythonのリストではこれができない）
print("\\n2倍にする:", a * 2)
print("2乗にする:", a ** 2)
print("10を引く:", a - 10)` },

      { type: 'text', content: `## 2. よく使う配列の作り方` },
      { type: 'code', content: `import numpy as np

# 0から9の配列
print(np.arange(10))

# 0から1まで5等分
print(np.linspace(0, 1, 5))

# ゼロだけの配列
print(np.zeros(5))

# 指定した範囲のランダムな数
print(np.random.rand(5).round(2))` },

      { type: 'text', content: `## 3. 統計計算
テストの点数などのデータを分析してみましょう。` },
      { type: 'code', content: `import numpy as np

# クラスのテスト点数
points = np.array([72, 85, 60, 93, 78, 88, 65, 91, 74, 82])
print("点数:", points)
print()
print(f"平均点:   {np.mean(points):.1f} 点")
print(f"最高点:   {np.max(points)} 点")
print(f"最低点:   {np.min(points)} 点")
print(f"標準偏差: {np.std(points):.1f}")  # バラつき具合
print()

# 条件で絞り込む
passed = points[points >= 80]
print(f"80点以上: {passed}")
print(f"合格者数: {len(passed)} 人 / {len(points)} 人中")` },

      { type: 'text', content: `## 4. 2次元配列（行列）` },
      { type: 'code', content: `import numpy as np

# 2次元配列（3行×3列の行列）
matrix = np.array([
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9]
])
print("行列:\\n", matrix)
print("形状:", matrix.shape)  # (行数, 列数)
print("合計:", np.sum(matrix))
print("行ごとの合計:", np.sum(matrix, axis=1))` },

      { type: 'text', content: `## ✏️ 練習問題
気温データを使って平均・最高・最低を計算してみよう！` },
      { type: 'code', content: `import numpy as np

# 1週間の最高気温（℃）
temps = np.array([28, 31, 29, 33, 35, 30, 27])

# ↓ここに続きを書こう！
# 平均気温、最高気温、最低気温を print() で表示する

` },
    ]
  },

  // ─── lesson=matplotlib : グラフ描画 ───
  matplotlib: {
    title: '第3回：Matplotlibでグラフ描画',
    cells: () => [
      { type: 'text', content: `# 📊 第3回：Matplotlibでグラフ描画

**Matplotlib**（マットプロットリブ）はグラフを描くライブラリです。
データを「見える化」するのに使います。` },

      { type: 'text', content: `## 1. 折れ線グラフ` },
      { type: 'code', content: `import matplotlib.pyplot as plt
import numpy as np

x = [1, 2, 3, 4, 5]
y = [10, 25, 18, 30, 22]

fig, ax = plt.subplots(figsize=(7, 4))
ax.plot(x, y, marker='o', color='royalblue', linewidth=2, markersize=8)
ax.set_xlabel('月')
ax.set_ylabel('売上（万円）')
ax.set_title('月別売上推移')
ax.grid(True, alpha=0.3)
plt.tight_layout()
plt.show()` },

      { type: 'text', content: `## 2. 棒グラフ` },
      { type: 'code', content: `import matplotlib.pyplot as plt

subjects = ['国語', '数学', '英語', '理科', '社会']
scores   = [82, 75, 90, 68, 85]
colors   = ['steelblue', 'tomato', 'mediumseagreen', 'gold', 'mediumpurple']

fig, ax = plt.subplots(figsize=(7, 4))
bars = ax.bar(subjects, scores, color=colors, edgecolor='white', linewidth=1.5)

# 棒の上に点数を表示
for bar, score in zip(bars, scores):
    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1,
            str(score), ha='center', va='bottom', fontsize=11)

ax.set_ylim(0, 105)
ax.set_ylabel('点数')
ax.set_title('教科別成績')
ax.grid(axis='y', alpha=0.3)
plt.tight_layout()
plt.show()` },

      { type: 'text', content: `## 3. 円グラフ` },
      { type: 'code', content: `import matplotlib.pyplot as plt

labels = ['スマホ', 'ゲーム', '勉強', '運動', '睡眠', 'その他']
sizes  = [3.5, 2.0, 3.0, 1.5, 8.0, 6.0]  # 時間（h）
explode = (0.05,) * len(labels)

fig, ax = plt.subplots(figsize=(6, 6))
ax.pie(sizes, labels=labels, explode=explode, autopct='%1.1f%%',
       startangle=90, counterclock=False)
ax.set_title('1日の時間の使い方')
plt.tight_layout()
plt.show()` },

      { type: 'text', content: `## 4. 複数グラフを並べる` },
      { type: 'code', content: `import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 2 * np.pi, 200)

fig, axes = plt.subplots(1, 2, figsize=(10, 4))

# 左：sin波
axes[0].plot(x, np.sin(x), color='royalblue', linewidth=2)
axes[0].set_title('sin(x)')
axes[0].grid(True, alpha=0.3)

# 右：cos波
axes[1].plot(x, np.cos(x), color='tomato', linewidth=2)
axes[1].set_title('cos(x)')
axes[1].grid(True, alpha=0.3)

plt.suptitle('三角関数', fontsize=14)
plt.tight_layout()
plt.show()` },

      { type: 'text', content: `## ✏️ 練習問題
好きな科目の点数データで棒グラフを作ってみよう！` },
      { type: 'code', content: `import matplotlib.pyplot as plt

# ↓ データを自由に変えてみよう！
subjects = ['国語', '数学', '英語']
scores   = [80, 90, 75]

# グラフを描くコードをここに書こう

` },
    ]
  },

  // ─── lesson=pandas : データ処理 ───
  pandas: {
    title: '第4回：Pandasでデータ処理',
    cells: () => [
      { type: 'text', content: `# 📋 第4回：Pandasでデータ処理

**Pandas**（パンダス）は表形式のデータを扱うライブラリです。
ExcelやCSVのような「表」をPythonで操作できます。` },

      { type: 'text', content: `## 1. DataFrameを作る
DataFrame（データフレーム）＝ Excelの表のようなもの` },
      { type: 'code', content: `import pandas as pd

# 辞書からDataFrameを作る
data = {
    '名前':   ['田中', '鈴木', '佐藤', '高橋', '渡辺'],
    '学年':   [1, 2, 1, 3, 2],
    '数学':   [85, 92, 70, 96, 78],
    '英語':   [72, 88, 95, 80, 65],
}
df = pd.DataFrame(data)

print(df)
print(f"\\n行数: {len(df)} 行、列数: {len(df.columns)} 列")` },

      { type: 'text', content: `## 2. 列を取り出す・計算する` },
      { type: 'code', content: `import pandas as pd

data = {'名前': ['田中','鈴木','佐藤','高橋','渡辺'],
        '数学': [85, 92, 70, 96, 78],
        '英語': [72, 88, 95, 80, 65]}
df = pd.DataFrame(data)

# 1列だけ取り出す
print("数学の点数:")
print(df['数学'])

# 新しい列を追加（平均点）
df['平均'] = (df['数学'] + df['英語']) / 2
print("\\n平均点を追加:")
print(df)` },

      { type: 'text', content: `## 3. 並び替え・絞り込み` },
      { type: 'code', content: `import pandas as pd

data = {'名前': ['田中','鈴木','佐藤','高橋','渡辺'],
        '数学': [85, 92, 70, 96, 78],
        '英語': [72, 88, 95, 80, 65]}
df = pd.DataFrame(data)
df['平均'] = (df['数学'] + df['英語']) / 2

# 平均点で降順に並び替え
print("=== 成績順 ===")
print(df.sort_values('平均', ascending=False).reset_index(drop=True))

# 数学が85点以上の人だけ絞り込む
print("\\n=== 数学85点以上 ===")
print(df[df['数学'] >= 85])` },

      { type: 'text', content: `## 4. 統計情報をまとめて表示` },
      { type: 'code', content: `import pandas as pd

data = {'名前': ['田中','鈴木','佐藤','高橋','渡辺'],
        '数学': [85, 92, 70, 96, 78],
        '英語': [72, 88, 95, 80, 65]}
df = pd.DataFrame(data)

# describe()で統計情報を一気に表示
print(df[['数学','英語']].describe().round(1))` },

      { type: 'text', content: `## 5. グラフと組み合わせる` },
      { type: 'code', content: `import pandas as pd
import matplotlib.pyplot as plt

data = {'名前': ['田中','鈴木','佐藤','高橋','渡辺'],
        '数学': [85, 92, 70, 96, 78],
        '英語': [72, 88, 95, 80, 65]}
df = pd.DataFrame(data)

fig, ax = plt.subplots(figsize=(8, 4))
x = range(len(df))
ax.bar([i-0.2 for i in x], df['数学'], width=0.35, label='数学', color='steelblue')
ax.bar([i+0.2 for i in x], df['英語'], width=0.35, label='英語', color='coral')
ax.set_xticks(list(x)); ax.set_xticklabels(df['名前'])
ax.set_title('教科別成績比較'); ax.set_ylabel('点数')
ax.legend(); ax.grid(axis='y', alpha=0.3)
plt.tight_layout(); plt.show()` },

      { type: 'text', content: `## ✏️ 練習問題
自分でデータを追加して、平均点が一番高い人を探してみよう！` },
      { type: 'code', content: `import pandas as pd

# ↓ 好きなデータに変えてもOK！
data = {
    '名前': ['田中', '鈴木', '佐藤'],
    '数学': [85, 92, 70],
    '英語': [72, 88, 95]
}
df = pd.DataFrame(data)

# 平均点を計算して、一番高い人を表示してみよう

` },
    ]
  },

  // ─── lesson=ai : AI入門 ───
  ai: {
    title: '第5回：AIに学習させてみよう',
    cells: () => [
      { type: 'text', content: `# 🤖 第5回：AIに学習させてみよう

**scikit-learn**（サイキットラーン）を使って、簡単なAI（機械学習）を体験します。

> AIは「データから法則を学ぶ」プログラムです。今日は「花のデータからAIに種類を当ててもらう」実験をします！` },

      { type: 'text', content: `## 1. データを準備する
**Iris（アイリス）データセット** ＝ 3種類の花のサイズデータ（有名な機械学習の練習データ）` },
      { type: 'code', content: `from sklearn.datasets import load_iris
import pandas as pd

# データを読み込む
iris = load_iris()
df = pd.DataFrame(iris.data, columns=iris.feature_names)
df['species'] = [iris.target_names[t] for t in iris.target]

print("データの先頭5行:")
print(df.head())
print(f"\\nデータ数: {len(df)} 件")
print("花の種類:", iris.target_names)` },

      { type: 'text', content: `## 2. データを可視化する
AIに学習させる前に、データがどんな形をしているか見てみましょう。` },
      { type: 'code', content: `from sklearn.datasets import load_iris
import matplotlib.pyplot as plt
import pandas as pd

iris = load_iris()
df = pd.DataFrame(iris.data, columns=iris.feature_names)
df['species'] = iris.target

colors = ['tomato', 'steelblue', 'mediumseagreen']
labels = iris.target_names

fig, ax = plt.subplots(figsize=(7, 5))
for i, (color, label) in enumerate(zip(colors, labels)):
    mask = df['species'] == i
    ax.scatter(df[mask]['sepal length (cm)'],
               df[mask]['petal length (cm)'],
               color=color, label=label, alpha=0.7, s=60)

ax.set_xlabel('Sepal Length (cm)')
ax.set_ylabel('Petal Length (cm)')
ax.set_title('Iris Dataset')
ax.legend()
ax.grid(True, alpha=0.3)
plt.tight_layout()
plt.show()` },

      { type: 'text', content: `## 3. AIを学習させる
データを「学習用」と「テスト用」に分けて、AIに学ばせます。` },
      { type: 'code', content: `from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier

iris = load_iris()
X = iris.data    # 特徴量（花のサイズ）
y = iris.target  # 正解ラベル（花の種類）

# 学習用80%・テスト用20%に分ける
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42)

print(f"学習データ: {len(X_train)} 件")
print(f"テストデータ: {len(X_test)} 件")

# 決定木（Decision Tree）というAIを学習させる
model = DecisionTreeClassifier(max_depth=3, random_state=42)
model.fit(X_train, y_train)  # ← ここで「学習」が行われる

print("\\n✅ 学習完了！")` },

      { type: 'text', content: `## 4. 正解率を確認する` },
      { type: 'code', content: `from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier

iris = load_iris()
X, y = iris.data, iris.target
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = DecisionTreeClassifier(max_depth=3, random_state=42)
model.fit(X_train, y_train)

# テストデータで正解率を計算
accuracy = model.score(X_test, y_test)
print(f"正解率: {accuracy * 100:.1f}%")

# 予測してみる
predictions = model.predict(X_test[:5])
correct     = y_test[:5]
print("\\n最初の5件の予測:")
for pred, ans in zip(predictions, correct):
    mark = "✅" if pred == ans else "❌"
    print(f"  予測: {iris.target_names[pred]:<15} 正解: {iris.target_names[ans]} {mark}")` },

      { type: 'text', content: '## ✏️ チャレンジ\n`max_depth` の数値を変えると正解率はどう変わるか試してみよう！（1〜10くらいで試してみて）' },
      { type: 'code', content: `from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier

iris = load_iris()
X, y = iris.data, iris.target
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# ↓ max_depth の数値を変えてみよう！
max_depth = 3

model = DecisionTreeClassifier(max_depth=max_depth, random_state=42)
model.fit(X_train, y_train)
accuracy = model.score(X_test, y_test)
print(f"max_depth={max_depth} のとき、正解率: {accuracy * 100:.1f}%")
` },
    ]
  },

};

// ============================================================
// デフォルトノートブック（URLパラメータで切り替え）
// ============================================================
function buildDefaultNotebook() {
  // URLパラメータを読む  例: ?lesson=basics
  const params = new URLSearchParams(window.location.search);
  const lessonKey = params.get('lesson') || 'default';
  const lesson = LESSONS[lessonKey] || LESSONS['default'];

  // ページタイトルを更新
  if (lessonKey !== 'default') {
    document.title = lesson.title + ' - Pythonノートブック';
    const h1 = document.querySelector('#app-header h1');
    if (h1) h1.textContent = lesson.title;
  }

  // URLパラメータに対応したセルを追加
  lesson.cells().forEach(cell => addCell(cell));
}

// ============================================================
// ウェルカム画面
// ============================================================

function showWelcomeScreen() {
  document.getElementById('welcome-overlay').classList.remove('hidden');
  // タイプライターアニメーション
  const nameEl = document.getElementById('picker-name');
  if (nameEl) {
    nameEl.textContent = '';
    const full = 'PyHiroba';
    let i = 0;
    const tid = setInterval(() => {
      i++;
      nameEl.textContent = full.slice(0, i);
      if (i >= full.length) {
        clearInterval(tid);
        const caret = document.createElement('span');
        caret.className = 'picker-caret';
        nameEl.appendChild(caret);
      }
    }, 130);
  }
}

function dismissWelcomeScreen() {
  document.getElementById('welcome-overlay').classList.add('hidden');
}

/** 新規ノートブックを開く */
function openNewNotebook() {
  dismissWelcomeScreen();
  buildDefaultNotebook();
}

// ============================================================
// .ipynb 読み込み / 書き出し
// ============================================================

/** ウェルカム画面の「ファイルを開く」ハンドラ */
function onIpynbUpload(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  _readAndLoadIpynb(file, true);
}

/** ヘッダーの「インポート」ボタンハンドラ */
function onIpynbHeaderUpload(event) {
  const file = event.target.files[0];
  event.target.value = ''; // 同じファイルを再選択できるよう先にリセット
  if (!file) return;

  // 確認ダイアログを必ず表示
  const ok = confirm(
    '「' + file.name + '」を読み込みます。\n\n' +
    '現在のノートブックの内容はすべて削除され、\n' +
    'インポートしたファイルの内容に置き換わります。\n\n' +
    'よろしいですか？'
  );
  if (!ok) return;

  _readAndLoadIpynb(file, false);
}

/**
 * .ipynb ファイルを FileReader で読み込み loadIpynb() に渡す
 * @param {File}    file          - 読み込む File オブジェクト
 * @param {boolean} fromWelcome   - true のときウェルカム画面を閉じる
 */
function _readAndLoadIpynb(file, fromWelcome) {
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const json = JSON.parse(e.target.result);
      if (fromWelcome) dismissWelcomeScreen();
      loadIpynb(json);
      // ファイル名をタイトルに反映
      const name = file.name.replace(/\.ipynb$/i, '');
      document.title = name + ' - PyHiroba';
      const h1 = document.querySelector('#app-header h1');
      if (h1) h1.textContent = name;
    } catch (err) {
      alert('.ipynb ファイルの読み込みに失敗しました。\nファイルが壊れているか、形式が正しくない可能性があります。\n\n' + err.message);
    }
  };
  reader.onerror = function () {
    alert('ファイルの読み込み中にエラーが発生しました。');
  };
  reader.readAsText(file, 'UTF-8');
}

/** .ipynb JSON をセルにロード（既存セルは全て置き換え） */
function loadIpynb(json) {
  // 状態をリセット
  cells   = [];
  editors = {};
  outputs = {};
  nextId  = 0;

  const ipynbCells = json.cells || [];
  ipynbCells.forEach(c => {
    const src = Array.isArray(c.source) ? c.source.join('') : (c.source || '');
    if (c.cell_type === 'code') {
      cells.push({ id: nextId++, type: 'code', content: src, slides: [] });
    } else if (c.cell_type === 'markdown') {
      cells.push({ id: nextId++, type: 'text', content: src, slides: [] });
    }
    // raw セルはスキップ
  });

  // セルが0個の場合は空セルを追加
  if (cells.length === 0) {
    cells.push({ id: nextId++, type: 'code', content: '', slides: [] });
  }

  renderAll();
}

// ============================================================
// Google Drive / Colab の公開ノートブック読み込み
// ============================================================
// Drive API 専用・PyHirobaドメイン限定に制限した公開用APIキー。
// 公開ファイル（リンクを知っている全員：閲覧者）の読み取りのみ可能で、
// 非公開ファイルやアカウント情報には一切アクセスできない。
const GDRIVE_API_KEY = 'AIzaSyBcOmDs7KqQzbp5MbK3wps6AgHHp6FDYMA';

/** Colab / Drive のリンクから Drive ファイルID を取り出す（なければ null） */
function extractDriveId(url) {
  if (!url) return null;
  const s = String(url).trim();
  const patterns = [
    /colab\.research\.google\.com\/drive\/([a-zA-Z0-9_-]{20,})/,
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{20,})/,
    /docs\.google\.com\/[^/]+\/d\/([a-zA-Z0-9_-]{20,})/,
    /(?:drive|colab)\.google\.com\/[^]*?[?&]id=([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  // URL ではなく、ファイルID だけが貼られた場合
  if (/^[a-zA-Z0-9_-]{25,}$/.test(s)) return s;
  return null;
}

/** Drive のファイルID から公開ノートブックの JSON とファイル名を取得する */
async function fetchDriveIpynb(fileId) {
  const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
  const res = await fetch(`${base}?alt=media&key=${GDRIVE_API_KEY}`);
  if (res.status === 404) throw new Error('GD_404');
  if (res.status === 401 || res.status === 403) throw new Error('GD_403');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  // ファイル名も取得（失敗しても致命的ではない）
  let name = '';
  try {
    const meta = await fetch(`${base}?fields=name&key=${GDRIVE_API_KEY}`);
    if (meta.ok) {
      const m = await meta.json();
      name = (m.name || '').replace(/\.ipynb$/i, '');
    }
  } catch (_) { /* 名前が取れなくても続行 */ }

  return { json, name };
}

/** URL 入力欄からロード */
async function loadFromUrlInput() {
  const input = document.getElementById('nb-url-input');
  const url = (input && input.value.trim()) || '';
  if (!url) return;
  await loadFromUrl(url);
}

/**
 * URL（または Drive ファイルID）から .ipynb をフェッチしてロードする。
 * ?nb= / ?gdrive= パラメータ経由でも使用。
 * Colab / Google Drive の公開リンク、GitHub の URL に対応。
 */
async function loadFromUrl(rawUrl) {
  const btn = document.querySelector('.picker-url-row button');
  if (btn) { btn.textContent = '読込中...'; btn.disabled = true; }

  try {
    let json, nameHint = '';

    const driveId = extractDriveId(rawUrl);
    if (driveId) {
      // Google Drive / Colab の公開ノートブック
      const r = await fetchDriveIpynb(driveId);
      json = r.json;
      nameHint = r.name;
    } else {
      // GitHub のブラウザ URL を raw URL に変換してから取得
      let url = rawUrl;
      const ghMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
      if (ghMatch) {
        url = `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}/${ghMatch[3]}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
      nameHint = url.split('/').pop().replace(/\.ipynb$/i, '');
    }

    dismissWelcomeScreen();
    loadIpynb(json);

    // ファイル名をタイトルに反映
    const name = (nameHint || '').replace(/\.ipynb$/i, '');
    if (name) {
      document.title = name + ' - PyHiroba';
      const h1 = document.querySelector('#app-header h1');
      if (h1) h1.textContent = name;
    }
  } catch (err) {
    let msg;
    if (err.message === 'GD_404') {
      msg = 'ファイルが見つからないか、公開されていません。\n\n' +
            '・リンクが正しいか確認してください\n' +
            '・Google Drive / Colab で「共有」→「リンクを知っている全員（閲覧者）」に\n' +
            '　設定されているか確認してください';
    } else if (err.message === 'GD_403') {
      msg = 'このファイルにアクセスできませんでした。\n\n' +
            '・ファイルが「リンクを知っている全員（閲覧者）」で共有されているか\n' +
            '　確認してください\n' +
            '・しばらく待ってから再度お試しください';
    } else {
      msg = 'ノートブックの読み込みに失敗しました。\n' +
            'URLが正しいか確認してください。\n' +
            '（GitHubは raw URL、Google Drive / Colab は公開リンクをご利用ください）\n\n' +
            'エラー: ' + err.message;
    }
    alert(msg);
  } finally {
    if (btn) { btn.textContent = '開く'; btn.disabled = false; }
  }
}

/** 現在のノートブックを .ipynb としてダウンロード */
function downloadIpynb() {
  saveAllEditors();

  const nb = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3'
      },
      language_info: {
        name: 'python',
        version: '3.11.0'
      }
    },
    cells: cells.map((cell, idx) => {
      const source = toIpynbSource(cell.content || '');
      if (cell.type === 'code') {
        return {
          cell_type: 'code',
          execution_count: null,
          id: `cell-${idx}`,
          metadata: {},
          outputs: [],
          source
        };
      } else {
        // text / slide → markdown として出力
        return {
          cell_type: 'markdown',
          id: `cell-${idx}`,
          metadata: {},
          source
        };
      }
    })
  };

  const blob = new Blob([JSON.stringify(nb, null, 2)], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  // タイトルからファイル名を生成
  const titleMatch = document.title.match(/^(.+?) - /);
  const filename = titleMatch
    ? titleMatch[1].replace(/[^\w\-_ ]/g, '_') + '.ipynb'
    : 'notebook.ipynb';
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

/** content 文字列を .ipynb の source 配列形式に変換 */
function toIpynbSource(content) {
  if (!content) return [];
  const lines = content.split('\n');
  // 各行末に \n を付与（最後の行を除く）
  return lines.map((line, i) => i < lines.length - 1 ? line + '\n' : line);
}

// ============================================================
// セル管理
// ============================================================

/**
 * セルを追加する
 * @param {Object} opts - { type, content, afterId }
 * afterId が指定されたセルの下に挿入。なければ末尾に追加。
 */
function addCell(opts = {}) {
  const cell = {
    id:      nextId++,
    type:    opts.type    || 'code',
    content: opts.content || '',
    slides:  opts.slides  || []
  };

  if (opts.afterId != null) {
    const idx = cells.findIndex(c => c.id === opts.afterId);
    cells.splice(idx + 1, 0, cell);
  } else {
    cells.push(cell);
  }

  renderAll();
  focusCell(cell.id);
  return cell.id;
}

/** 画面下の「追加」ボタン用 */
function appendCell(type) {
  addCell({ type });
}

/** セルを削除する */
function deleteCell(id) {
  if (cells.length <= 1) {
    alert('最後のセルは削除できません。');
    return;
  }
  // 削除確認（中身があるときだけ）
  const cell = cells.find(c => c.id === id);
  if (cell && cell.content.trim().length > 20) {
    if (!confirm('このセルを削除しますか？')) return;
  }
  cells = cells.filter(c => c.id !== id);
  delete editors[id];
  delete outputs[id];
  renderAll();
}

/** セルを上に移動 */
function moveCellUp(id) {
  const idx = cells.findIndex(c => c.id === id);
  if (idx > 0) {
    [cells[idx - 1], cells[idx]] = [cells[idx], cells[idx - 1]];
    renderAll();
  }
}

/** セルを下に移動 */
function moveCellDown(id) {
  const idx = cells.findIndex(c => c.id === id);
  if (idx < cells.length - 1) {
    [cells[idx], cells[idx + 1]] = [cells[idx + 1], cells[idx]];
    renderAll();
  }
}

/** セルのタイプを変更 */
function changeCellType(id, newType) {
  saveEditorContent(id);
  const cell = cells.find(c => c.id === id);
  if (cell) {
    cell.type = newType;
    if (newType === 'slide' && !cell.slides) cell.slides = [];
  }
  renderAll();
}

/** 現在のエディタ内容をcells配列に保存 */
function saveEditorContent(id) {
  if (editors[id]) {
    const cell = cells.find(c => c.id === id);
    if (cell) cell.content = editors[id].getValue();
  }
}

/** 全エディタ内容を保存 */
function saveAllEditors() {
  cells.forEach(c => saveEditorContent(c.id));
}

/** 指定セルにフォーカスを当てる */
function focusCell(id) {
  setTimeout(() => {
    if (editors[id]) {
      editors[id].focus();
    }
  }, 80);
}

// ============================================================
// レンダリング
// ============================================================
function renderAll() {
  // エディタ内容を先に保存
  saveAllEditors();

  // 古いエディタインスタンスをクリア
  Object.keys(editors).forEach(id => { delete editors[id]; });

  const container = document.getElementById('notebook-container');
  container.innerHTML = '';

  cells.forEach((cell, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'cell-wrapper';
    wrapper.innerHTML = buildCellHTML(cell, idx);
    container.appendChild(wrapper);

    // コードセルのエディタ初期化
    if (cell.type === 'code') {
      const textarea = wrapper.querySelector(`.cell-code-ta[data-id="${cell.id}"]`);
      if (textarea) {
        const editor = CodeMirror.fromTextArea(textarea, {
          mode: 'python',
          lineNumbers: true,
          indentUnit: 4,
          tabSize: 4,
          lineWrapping: true,
          autofocus: false,
          // コード補完は無効（要件より）
          extraKeys: {
            'Shift-Enter': () => runCell(cell.id),
            'Tab': cm => {
              if (cm.somethingSelected()) {
                cm.indentSelection('add');
              } else {
                cm.replaceSelection('    ');
              }
            }
          }
        });
        editors[cell.id] = editor;

        // フォーカス時にセルをハイライト
        editor.on('focus', () => {
          wrapper.querySelector('.cell').classList.add('cell-focused');
        });
        editor.on('blur', () => {
          wrapper.querySelector('.cell').classList.remove('cell-focused');
        });
      }
    }

    // 保存済み出力を復元
    if (outputs[cell.id]) {
      renderOutput(cell.id, outputs[cell.id]);
    }
  });
}

/** セルのHTMLを構築する */
function buildCellHTML(cell, idx) {
  const isFirst = idx === 0;
  const isLast  = idx === cells.length - 1;

  // 連続するテキストセルの2個目以降は、ツールバーを隠して文章をシームレスに見せる
  const isContText = cell.type === 'text' && idx > 0 && cells[idx - 1] && cells[idx - 1].type === 'text';

  let typeLabel, toolbarClass, contentHTML;

  if (cell.type === 'code') {
    typeLabel    = '🐍 コード';
    toolbarClass = 'cell-code';
    contentHTML  = buildCodeContent(cell);
  } else if (cell.type === 'text') {
    typeLabel    = '📝 テキスト';
    toolbarClass = 'cell-text';
    contentHTML  = buildTextContent(cell);
  } else if (cell.type === 'image') {
    typeLabel    = '🖼 画像';
    toolbarClass = 'cell-image';
    contentHTML  = buildImageContent(cell);
  } else if (cell.type === 'slide') {
    typeLabel    = '🎞 スライド';
    toolbarClass = 'cell-slide';
    contentHTML  = buildSlideContent(cell);
  }

  return `
    <div class="cell ${toolbarClass}${isContText ? ' cell-text-cont' : ''}" data-cell-id="${cell.id}">
      <div class="cell-toolbar">
        <div class="cell-toolbar-left">
          <span class="cell-number">[${idx + 1}]</span>
          <div class="cell-type-toggle">
            <button class="cell-type-btn ${cell.type === 'code' ? 'is-active' : ''}" data-type="code"
              onclick="changeCellType(${cell.id},'code')" title="コードセル">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              コード
            </button>
            <button class="cell-type-btn ${cell.type === 'text' ? 'is-active' : ''}" data-type="text"
              onclick="changeCellType(${cell.id},'text')" title="テキストセル">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg>
              テキスト
            </button>
            ${(cell.type === 'image' || cell.type === 'slide') ? `
            <button class="cell-type-btn is-active" data-type="${cell.type}" title="${cell.type === 'image' ? '画像セル' : 'スライドセル'}">
              ${cell.type === 'image' ? '🖼 画像' : '🎞 スライド'}
            </button>` : ''}
          </div>
        </div>
        <div class="cell-toolbar-right">
          ${cell.type === 'code' ? `
            <button class="btn-run" onclick="runCell(${cell.id})" title="コードを実行 (Shift+Enter)" id="run-btn-${cell.id}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              実行
            </button>` : cell.type === 'slide' ? `
            <button class="btn-edit-text" onclick="document.getElementById('slide-input-${cell.id}').click()" title="画像を追加">
              ＋ 画像を追加
            </button>
            <input type="file" id="slide-input-${cell.id}" accept="image/*" multiple style="display:none"
              onchange="onSlideSelect(event,${cell.id})">` : ''}
          <button class="btn-icon" onclick="moveCellUp(${cell.id})"   ${isFirst ? 'disabled' : ''} title="上に移動">↑</button>
          <button class="btn-icon" onclick="moveCellDown(${cell.id})" ${isLast  ? 'disabled' : ''} title="下に移動">↓</button>
          <button class="btn-icon btn-delete" onclick="deleteCell(${cell.id})" title="このセルを削除">✕</button>
        </div>
      </div>
      ${contentHTML}
    </div>
    <div class="cell-add-between">
      <button class="btn-add-between" onclick="addCell({afterId:${cell.id},type:'code'})" title="ここにセルを追加">+</button>
    </div>`;
}

function buildCodeContent(cell) {
  return `
    <div class="cell-editor">
      <textarea class="cell-code-ta" data-id="${cell.id}">${escHtml(cell.content)}</textarea>
    </div>
    <div class="cell-output" id="output-${cell.id}"></div>`;
}

/**
 * 標準仕様で崩れやすい Markdown を補正してから marked で描画する。
 * Colab 等でよくある「# の直後に半角スペースが無い見出し」（例: ###算術演算子）
 * を見出しとして描画できるようにする。
 */
function renderMarkdown(src) {
  return marked.parse(preprocessMarkdown(src));
}

/** marked に渡す前の Markdown 補正 */
function preprocessMarkdown(src) {
  if (!src) return src;
  // フェンスドコードブロック（``` / ~~~）の中は触らないように分割して処理する
  const parts = String(src).split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) continue; // コードブロックはそのまま
    // 行頭の # 1〜6個の直後に空白が無い場合に半角スペースを補う
    //   ###算術演算子 → ### 算術演算子
    parts[i] = parts[i].replace(/^(\s{0,3})(#{1,6})([^\s#])/gm, '$1$2 $3');
  }
  return parts.join('');
}

function buildTextContent(cell) {
  const hasContent = cell.content && cell.content.trim();
  const media = hasContent && isMediaOnlyMarkdown(cell.content);
  const rendered = hasContent
    ? renderMarkdown(cell.content)
    : '<p class="placeholder">ここをクリックして編集... (Markdownが使えます)</p>';
  // 画像だけのセルはクリックで拡大表示、それ以外はクリックで編集
  const dispClass = media ? 'cell-text-display is-media' : 'cell-text-display';
  const onClick   = media ? `openTextImage(${cell.id})` : `startTextEdit(${cell.id})`;
  return `
    <div class="${dispClass}" id="text-disp-${cell.id}" onclick="${onClick}">
      ${rendered}
    </div>
    <div class="cell-text-editor hidden" id="text-edit-${cell.id}">
      <textarea
        onblur="finishTextEdit(${cell.id})"
        onkeydown="onTextKeydown(event, ${cell.id})"
      >${escHtml(cell.content)}</textarea>
      <div class="text-editor-hint">Shift+Enter または Esc で確定</div>
    </div>`;
}

/**
 * テキストセルの中身が「画像だけ」かどうかを判定する。
 * .ipynb に埋め込まれたスライド画像（![](data:...) や <img src="data:...">）を
 * いい感じに表示するために使う。
 */
function isMediaOnlyMarkdown(content) {
  if (!content) return false;
  const hasImage = /!\[[^\]]*\]\([^)]+\)|<img[\s>]/i.test(content);
  if (!hasImage) return false;
  // 画像・装飾タグ・空白を取り除いて、文章が残らなければ「画像だけ」
  const stripped = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')      // Markdown画像
    .replace(/<img[^>]*>/gi, '')               // <img>
    .replace(/<\/?(div|p|center|figure|br)[^>]*>/gi, '') // 装飾タグ
    .replace(/\s+/g, '');
  return stripped.length === 0;
}

/** テキストセル内の最初の画像をライトボックスで拡大表示する */
function openTextImage(id) {
  const cell = cells.find(c => c.id === id);
  if (!cell) return;
  let src = null;
  const md  = cell.content.match(/!\[[^\]]*\]\(([^)]+)\)/);
  const tag = cell.content.match(/<img[^>]*\ssrc=["']([^"']+)["']/i);
  if (md)  src = md[1];
  else if (tag) src = tag[1];
  if (src) openImageLightbox(src);
}

function buildImageContent(cell) {
  if (cell.content) {
    return `
      <div class="cell-image-area">
        <div class="cell-image-display">
          <img src="${cell.content}" alt="画像">
        </div>
        <button class="btn-icon" onclick="clearImage(${cell.id})" style="margin-top:8px;">
          ✕ 画像を削除
        </button>
      </div>`;
  }
  return `
    <div class="cell-image-area">
      <div class="image-drop-zone" id="drop-zone-${cell.id}"
        onclick="document.getElementById('img-input-${cell.id}').click()"
        ondragover="event.preventDefault(); this.classList.add('drag-over')"
        ondragleave="this.classList.remove('drag-over')"
        ondrop="onImageDrop(event, ${cell.id})">
        <div class="drop-icon">🖼</div>
        <p>クリックして画像を選択</p>
        <small>または ここにドラッグ&ドロップ（PNG, JPG, GIF, SVG）</small>
      </div>
      <input type="file" id="img-input-${cell.id}" accept="image/*" style="display:none"
        onchange="onImageSelect(event, ${cell.id})">
    </div>`;
}

function buildSlideContent(cell) {
  if (!cell.slides) cell.slides = [];
  if (cell.slides.length === 0) {
    return `
      <div class="slide-drop-zone" id="slide-drop-${cell.id}"
        onclick="document.getElementById('slide-input2-${cell.id}').click()"
        ondragover="event.preventDefault();this.classList.add('drag-over')"
        ondragleave="this.classList.remove('drag-over')"
        ondrop="onSlideDrop(event,${cell.id})">
        <div class="drop-icon">🎞</div>
        <p>クリックして画像を選択（複数可）</p>
        <small>または ここにドラッグ&ドロップ</small>
      </div>
      <input type="file" id="slide-input2-${cell.id}" accept="image/*" multiple style="display:none"
        onchange="onSlideSelect(event,${cell.id})">`;
  }

  const thumbs = cell.slides.map((src, i) => `
    <div class="slide-thumb-wrap" onclick="openSlide(${cell.id},${i})">
      <img src="${src}" alt="スライド${i+1}">
      <span class="slide-num">${i+1}</span>
      <button class="slide-thumb-del" onclick="event.stopPropagation();deleteSlide(${cell.id},${i})" title="削除">✕</button>
    </div>`).join('');

  return `
    <div class="slide-area">
      <div class="slide-strip">
        ${thumbs}
        <button class="slide-add-chip" onclick="document.getElementById('slide-input2-${cell.id}').click()">
          ＋<span>画像を追加</span>
        </button>
      </div>
    </div>
    <input type="file" id="slide-input2-${cell.id}" accept="image/*" multiple style="display:none"
      onchange="onSlideSelect(event,${cell.id})">`;
}

// ============================================================
// スライドセル管理
// ============================================================
function onSlideSelect(event, id) {
  const files = Array.from(event.target.files);
  if (!files.length) return;
  event.target.value = '';
  loadSlideFiles(id, files);
}

function onSlideDrop(event, id) {
  event.preventDefault();
  document.getElementById(`slide-drop-${id}`)?.classList.remove('drag-over');
  const files = Array.from(event.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  loadSlideFiles(id, files);
}

function loadSlideFiles(id, files) {
  const cell = cells.find(c => c.id === id);
  if (!cell) return;
  if (!cell.slides) cell.slides = [];
  let remaining = files.length;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      cell.slides.push(e.target.result);
      remaining--;
      if (remaining === 0) renderAll();
    };
    reader.readAsDataURL(file);
  });
}

function deleteSlide(cellId, idx) {
  const cell = cells.find(c => c.id === cellId);
  if (!cell) return;
  cell.slides.splice(idx, 1);
  renderAll();
}

// ============================================================
// ライトボックス
// ============================================================
function openSlide(cellId, idx) {
  const cell = cells.find(c => c.id === cellId);
  if (!cell || !cell.slides.length) return;
  lbCellId = cellId;
  lbIdx    = idx;
  // スライドセル用：前後ボタンを表示
  const prev = document.querySelector('.lightbox-prev');
  const next = document.querySelector('.lightbox-next');
  if (prev) prev.style.display = '';
  if (next) next.style.display = '';
  updateLightbox();
  document.getElementById('slide-lightbox').classList.remove('hidden');
  document.addEventListener('keydown', onLightboxKey);
}

/** 単体画像（テキストセル内の画像など）をライトボックスで表示する */
function openImageLightbox(src) {
  lbCellId = null;
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox-counter').textContent = '';
  // 単体画像なので前後ボタンは隠す
  const prev = document.querySelector('.lightbox-prev');
  const next = document.querySelector('.lightbox-next');
  if (prev) prev.style.display = 'none';
  if (next) next.style.display = 'none';
  document.getElementById('slide-lightbox').classList.remove('hidden');
  document.addEventListener('keydown', onLightboxKey);
}

function updateLightbox() {
  const cell = cells.find(c => c.id === lbCellId);
  if (!cell) return;
  const total = cell.slides.length;
  document.getElementById('lightbox-img').src = cell.slides[lbIdx];
  document.getElementById('lightbox-counter').textContent = `${lbIdx + 1} / ${total}`;
  document.querySelector('.lightbox-prev').disabled = lbIdx === 0;
  document.querySelector('.lightbox-next').disabled = lbIdx === total - 1;
}

function lightboxNav(dir) {
  const cell = cells.find(c => c.id === lbCellId);
  if (!cell) return;
  lbIdx = Math.max(0, Math.min(cell.slides.length - 1, lbIdx + dir));
  updateLightbox();
}

function closeLightbox(event) {
  if (event && event.target !== document.getElementById('slide-lightbox')) return;
  document.getElementById('slide-lightbox').classList.add('hidden');
  document.getElementById('lightbox-img').src = '';
  document.removeEventListener('keydown', onLightboxKey);
  lbCellId = null;
}

function onLightboxKey(e) {
  if (e.key === 'Escape')      closeLightbox();
  if (e.key === 'ArrowLeft')   lightboxNav(-1);
  if (e.key === 'ArrowRight')  lightboxNav(1);
}

// ============================================================
// テキストセル編集
// ============================================================
function startTextEdit(id) {
  const disp = document.getElementById(`text-disp-${id}`);
  const edit = document.getElementById(`text-edit-${id}`);
  if (!disp || !edit) return;
  // 連続テキストセルで隠れているツールバーを編集中は表示する
  const cellEl = document.querySelector(`.cell[data-cell-id="${id}"]`);
  if (cellEl) cellEl.classList.add('editing');
  disp.classList.add('hidden');
  edit.classList.remove('hidden');
  const ta = edit.querySelector('textarea');
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function finishTextEdit(id) {
  const disp = document.getElementById(`text-disp-${id}`);
  const edit = document.getElementById(`text-edit-${id}`);
  if (!disp || !edit) return;
  const ta = edit.querySelector('textarea');
  const cell = cells.find(c => c.id === id);
  if (cell && ta) cell.content = ta.value;
  disp.innerHTML = cell && cell.content && cell.content.trim()
    ? renderMarkdown(cell.content)
    : '<p class="placeholder">ここをクリックして編集... (Markdownが使えます)</p>';
  edit.classList.add('hidden');
  disp.classList.remove('hidden');
  // 編集終了でツールバーを再び隠す（連続テキストセルの場合）
  const cellEl = document.querySelector(`.cell[data-cell-id="${id}"]`);
  if (cellEl) cellEl.classList.remove('editing');
}

function toggleTextEdit(id) {
  const edit = document.getElementById(`text-edit-${id}`);
  if (edit && edit.classList.contains('hidden')) {
    startTextEdit(id);
  } else {
    finishTextEdit(id);
  }
}

function onTextKeydown(e, id) {
  if (e.key === 'Escape' || (e.key === 'Enter' && e.shiftKey)) {
    e.preventDefault();
    finishTextEdit(id);
  }
}

// ============================================================
// 画像セル
// ============================================================
function onImageSelect(event, id) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const cell = cells.find(c => c.id === id);
    if (cell) { cell.content = e.target.result; }
    renderAll();
  };
  reader.readAsDataURL(file);
}

function onImageDrop(event, id) {
  event.preventDefault();
  document.getElementById(`drop-zone-${id}`)?.classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = e => {
    const cell = cells.find(c => c.id === id);
    if (cell) { cell.content = e.target.result; }
    renderAll();
  };
  reader.readAsDataURL(file);
}

function clearImage(id) {
  const cell = cells.find(c => c.id === id);
  if (cell) { cell.content = ''; }
  renderAll();
}

// ============================================================
// Python実行
// ============================================================

/** セル単体を実行 */
async function runCell(id) {
  if (!pyodide) {
    alert('Python環境がまだ準備できていません。しばらくお待ちください。');
    return;
  }
  if (isRunning) return;

  const cell = cells.find(c => c.id === id);
  if (!cell || cell.type !== 'code') return;

  // エディタの現在の内容を取得
  const code = editors[id] ? editors[id].getValue() : cell.content;
  if (!code.trim()) return;

  isRunning = true;

  // UI：実行中状態に切り替え
  const cellEl = document.querySelector(`[data-cell-id="${id}"]`);
  if (cellEl) cellEl.classList.add('running');
  const runBtn = document.getElementById(`run-btn-${id}`);
  if (runBtn) {
    runBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="5"/></svg> 実行中';
    runBtn.disabled = true;
  }

  renderOutput(id, { status: 'running' });

  try {
    // import文を解析してパッケージを自動インストール
    // まだ読み込んでいないライブラリが必要な場合は分かりやすいUIを表示する
    try {
      let pkgLoading = false;
      await pyodide.loadPackagesFromImports(code, {
        messageCallback: (msg) => {
          // Pyodide が実際にダウンロードを始めると "Loading ..." が届く
          if (!pkgLoading && /loading/i.test(msg)) {
            pkgLoading = true;
            const names = (msg.match(/Loading\s+(.+)/i) || [])[1] || '';
            renderOutput(id, { status: 'loading-pkg', packages: names });
          }
        }
      });
      // 読み込みUIを出した場合は、実行中表示に戻す
      if (pkgLoading) renderOutput(id, { status: 'running' });
    } catch (_) { /* 失敗してもコード実行は試みる */ }

    // コードをPythonに渡す
    pyodide.globals.set('_cell_code', code);

    // 実行
    await pyodide.runPythonAsync(PYTHON_EXEC_CODE);

    // 結果を取得
    const stdout      = pyodide.globals.get('_out_text')    || '';
    const stderr      = pyodide.globals.get('_err_text')    || '';
    const errType     = pyodide.globals.get('_err_type');
    const errMsg      = pyodide.globals.get('_err_msg');
    const errTb       = pyodide.globals.get('_err_tb');
    const displayHtml = pyodide.globals.get('_display_html') || '';
    const lastDisplay = pyodide.globals.get('_last_display') || '';
    const figsProxy   = pyodide.globals.get('_figures');
    const figs = figsProxy ? figsProxy.toJs() : [];
    if (figsProxy?.destroy) figsProxy.destroy();

    const result = { status: 'done', stdout, stderr, errType, errMsg, errTb, figs, displayHtml, lastDisplay };
    outputs[id] = result;
    renderOutput(id, result);

  } catch (err) {
    const result = {
      status: 'done', stdout: '', stderr: '',
      errType: 'SystemError', errMsg: err.message,
      errTb: null, figs: []
    };
    outputs[id] = result;
    renderOutput(id, result);
  } finally {
    isRunning = false;
    if (cellEl) cellEl.classList.remove('running');
    if (runBtn) {
      runBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg> 実行';
      runBtn.disabled = false;
    }
  }
}

/** すべてのコードセルを順番に実行 */
async function runAllCells() {
  for (const cell of cells) {
    if (cell.type === 'code') {
      await runCell(cell.id);
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
// Python実行コード（各セル実行時に呼ぶ）
// ============================================================
const PYTHON_EXEC_CODE = `
_out_cap = _CapIO()
_err_cap = _CapIO()
_old_out = sys.stdout
_old_err = sys.stderr
sys.stdout = _out_cap
sys.stderr = _err_cap

_err_type    = None
_err_msg     = None
_err_tb      = None
_display_html = None   # DataFrame などの HTML repr
_last_display = None   # その他の値の text repr

# 前のグラフをクリア
plt.close('all')

try:
    _tree = _ast.parse(_cell_code)
    # 最後の文が「式」かどうか判定（Jupyter と同じ自動表示ロジック）
    if _tree.body and isinstance(_tree.body[-1], _ast.Expr):
        # 最後の式より前の行を exec
        _exec_part = _tree.body[:-1]
        if _exec_part:
            _mod = _ast.Module(body=_exec_part, type_ignores=[])
            _ast.fix_missing_locations(_mod)
            exec(compile(_mod, '<セル>', 'exec'), _nb_globals)
        # 最後の式を eval
        _expr_node = _ast.Expression(body=_tree.body[-1].value)
        _ast.fix_missing_locations(_expr_node)
        _last_val = eval(compile(_expr_node, '<セル>', 'eval'), _nb_globals)
        # None 以外なら表示
        if _last_val is not None:
            if hasattr(_last_val, '_repr_html_'):
                _display_html = _last_val._repr_html_()
            else:
                _last_display = repr(_last_val)
    else:
        exec(compile(_cell_code, '<セル>', 'exec'), _nb_globals)
except SystemExit:
    pass
except Exception as _e:
    _err_type = type(_e).__name__
    _err_msg  = str(_e)
    _err_tb   = traceback.format_exc()
finally:
    sys.stdout = _old_out
    sys.stderr = _old_err

_out_text = _out_cap.getvalue()
_err_text = _err_cap.getvalue()

# matplotlibのグラフをPNG画像として取得
_figures = []
for _fn in plt.get_fignums():
    try:
        _fig = plt.figure(_fn)
        _buf = io.BytesIO()
        _fig.savefig(_buf, format='png', bbox_inches='tight', dpi=110)
        _buf.seek(0)
        _figures.append(base64.b64encode(_buf.read()).decode('utf-8'))
    except Exception:
        pass

plt.close('all')
`;

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

  // DataFrame など _repr_html_() を持つオブジェクト
  if (result.displayHtml) {
    html += `<div class="output-html">${result.displayHtml}</div>`;
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
