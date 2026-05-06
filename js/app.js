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
      buildDefaultNotebook();            // ?lesson=xxx → レッスン直接ロード
    } else if (params.get('nb')) {
      await loadFromUrl(params.get('nb')); // ?nb=URL → .ipynb 直接ロード
    } else {
      showWelcomeScreen();               // パラメータなし → ウェルカム画面
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
      { type: 'text', content: `# 🐍 Pythonノートブックへようこそ！

ここでPythonプログラミングを練習することができます。

## 📌 基本的な使い方
- **コードセル**にPythonコードを書いて、**▶ 実行**ボタン（または **Shift+Enter**）で実行します
- 上のセルで作った変数は、**下のセルでも使えます**
- グラフはセルのすぐ下に自動で表示されます

## ⌨️ キーボードショートカット
| 操作 | キー |
|------|------|
| セルを実行 | **Shift + Enter** |
| インデント（字下げ） | **Tab** |

下のサンプルコードを **▶ 実行** して動かしてみよう！` },
      { type: 'code', content: `# 変数と計算
name = "山田太郎"
age  = 16
print("こんにちは、" + name + "さん！")
print(f"年齢: {age} 歳")

for i in range(1, 6):
    print(f"  {i} の 2乗 = {i ** 2}")` },
      { type: 'code', content: `# グラフを描いてみよう
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 2 * np.pi, 200)
fig, ax = plt.subplots(figsize=(8, 4))
ax.plot(x, np.sin(x), label='sin(x)', linewidth=2)
ax.plot(x, np.cos(x), label='cos(x)', linewidth=2)
ax.set_title('Sine and Cosine Waves')
ax.legend(); ax.grid(True, alpha=0.3)
plt.tight_layout(); plt.show()` },
      { type: 'text', content: `## ✏️ 自由に書いてみよう！` },
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

/** URL 入力欄からロード */
async function loadFromUrlInput() {
  const input = document.getElementById('nb-url-input');
  const url = (input && input.value.trim()) || '';
  if (!url) return;
  await loadFromUrl(url);
}

/** URL から .ipynb をフェッチしてロード（?nb= パラメータ経由でも使用） */
async function loadFromUrl(rawUrl) {
  // GitHub のブラウザ URL を raw URL に変換
  let url = rawUrl;
  const ghMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (ghMatch) {
    url = `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}/${ghMatch[3]}`;
  }

  const btn = document.querySelector('.welcome-url-go');
  if (btn) { btn.textContent = '読込中...'; btn.disabled = true; }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    dismissWelcomeScreen();
    loadIpynb(json);
    // URL のファイル名をタイトルに反映
    const name = url.split('/').pop().replace(/\.ipynb$/i, '');
    if (name) {
      document.title = name + ' - PyHiroba';
      const h1 = document.querySelector('#app-header h1');
      if (h1) h1.textContent = name;
    }
  } catch (err) {
    alert(
      'ノートブックの読み込みに失敗しました。\n' +
      'URLが正しいか確認してください。\n' +
      '（GitHubの場合は raw URL を使用してください）\n\n' +
      'エラー: ' + err.message
    );
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
    <div class="cell ${toolbarClass}" data-cell-id="${cell.id}">
      <div class="cell-toolbar">
        <div class="cell-toolbar-left">
          <span class="cell-number">[${idx + 1}]</span>
          <select class="cell-type-select" onchange="changeCellType(${cell.id}, this.value)" title="セルの種類を変更">
            <option value="code"  ${cell.type === 'code'  ? 'selected' : ''}>🐍 コード</option>
            <option value="text"  ${cell.type === 'text'  ? 'selected' : ''}>📝 テキスト</option>
            <option value="image" ${cell.type === 'image' ? 'selected' : ''}>🖼 画像</option>
            <option value="slide" ${cell.type === 'slide' ? 'selected' : ''}>🎞 スライド</option>
          </select>
        </div>
        <div class="cell-toolbar-right">
          ${cell.type === 'code' ? `
            <button class="btn-run" onclick="runCell(${cell.id})" title="コードを実行 (Shift+Enter)" id="run-btn-${cell.id}">
              ▶ 実行
            </button>` : cell.type === 'slide' ? `
            <button class="btn-edit-text" onclick="document.getElementById('slide-input-${cell.id}').click()" title="画像を追加">
              ＋ 画像を追加
            </button>
            <input type="file" id="slide-input-${cell.id}" accept="image/*" multiple style="display:none"
              onchange="onSlideSelect(event,${cell.id})">` : `
            <button class="btn-edit-text" onclick="toggleTextEdit(${cell.id})" title="テキストを編集">
              ✏️ 編集
            </button>`}
          <button class="btn-icon" onclick="moveCellUp(${cell.id})"   ${isFirst ? 'disabled' : ''} title="上に移動">↑</button>
          <button class="btn-icon" onclick="moveCellDown(${cell.id})" ${isLast  ? 'disabled' : ''} title="下に移動">↓</button>
          <button class="btn-icon" onclick="addCell({afterId:${cell.id},type:'code'})" title="下にコードセルを追加">＋</button>
          <button class="btn-icon btn-delete" onclick="deleteCell(${cell.id})" title="このセルを削除">✕</button>
        </div>
      </div>
      ${contentHTML}
    </div>`;
}

function buildCodeContent(cell) {
  return `
    <div class="cell-editor">
      <textarea class="cell-code-ta" data-id="${cell.id}">${escHtml(cell.content)}</textarea>
    </div>
    <div class="cell-output" id="output-${cell.id}"></div>`;
}

function buildTextContent(cell) {
  const rendered = cell.content
    ? marked.parse(cell.content)
    : '<p class="placeholder">ここをクリックして編集... (Markdownが使えます)</p>';
  return `
    <div class="cell-text-display" id="text-disp-${cell.id}" onclick="startTextEdit(${cell.id})">
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
  updateLightbox();
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
  disp.innerHTML = cell && cell.content
    ? marked.parse(cell.content)
    : '<p class="placeholder">ここをクリックして編集... (Markdownが使えます)</p>';
  edit.classList.add('hidden');
  disp.classList.remove('hidden');
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
  if (runBtn) { runBtn.textContent = '⏳ 実行中'; runBtn.disabled = true; }

  renderOutput(id, { status: 'running' });

  try {
    // import文を解析してパッケージを自動インストール
    try {
      await pyodide.loadPackagesFromImports(code);
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
    if (runBtn) { runBtn.textContent = '▶ 実行'; runBtn.disabled = false; }
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

  let html = '';

  // 標準出力
  if (result.stdout) {
    html += `<div class="output-text"><pre>${escHtml(result.stdout)}</pre></div>`;
  }

  // 警告（stderr）
  if (result.stderr) {
    html += `<div class="output-warning"><pre>${escHtml(result.stderr)}</pre></div>`;
  }

  // エラー
  if (result.errMsg) {
    const jaMsg = translateError(result.errType, result.errMsg);
    html += `
      <div class="output-error">
        <div class="error-title">❌ エラー: ${escHtml(result.errType || 'エラー')}</div>
        <div class="error-message">${escHtml(result.errMsg)}</div>
        <div class="error-japanese">${jaMsg}</div>
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
// エラーメッセージの日本語化
// ============================================================
function translateError(type, msg) {
  const rules = [
    // NameError
    { types: ['NameError'],
      pattern: /name '(.+?)' is not defined/,
      build: m => `変数・関数「${m[1]}」が定義されていません。スペルミスがないか確認してください。先にそのセルを実行しましたか？` },

    // SyntaxError
    { types: ['SyntaxError'],
      pattern: /invalid syntax/,
      build: () => '文法（syntax）が間違っています。括弧 () [] {} の対応、コロン「:」の付け忘れ、クォート「\'」「"」の対応を確認してください。' },
    { types: ['SyntaxError'],
      pattern: /EOL while scanning string literal/,
      build: () => '文字列が閉じられていません。クォート「\'」または「"」が対応しているか確認してください。' },
    { types: ['SyntaxError'],
      pattern: /unexpected EOF/,
      build: () => 'コードが途中で終わっています。括弧や文字列が閉じられているか確認してください。' },

    // IndentationError
    { types: ['IndentationError', 'TabError'],
      pattern: /.*/,
      build: () => 'インデント（字下げ）が正しくありません。if・for・def などの次の行は、スペース4つで字下げしてください。TabキーまたはSpaceキーが混在していませんか？' },

    // TypeError
    { types: ['TypeError'],
      pattern: /unsupported operand type\(s\) for (.+?): '(.+?)' and '(.+?)'/,
      build: m => `型が違います。「${m[2]}」型と「${m[3]}」型の計算はできません。数値と文字列を混在させていませんか？int() や str() で変換してみましょう。` },
    { types: ['TypeError'],
      pattern: /can only concatenate str \(not "(.+?)"\) to str/,
      build: m => `文字列（str）と「${m[1]}」型は結合できません。str() で文字列に変換してください。例: str(数値)` },
    { types: ['TypeError'],
      pattern: /'(.+?)' object is not subscriptable/,
      build: m => `「${m[1]}」型には [ ] でアクセスできません。` },
    { types: ['TypeError'],
      pattern: /'(.+?)' object is not callable/,
      build: m => `「${m[1]}」は関数ではないため、() で呼び出すことはできません。` },
    { types: ['TypeError'],
      pattern: /.*/,
      build: () => 'データの型（種類）が合っていません。数値・文字列・リストなどの型を確認してください。' },

    // IndexError
    { types: ['IndexError'],
      pattern: /list index out of range/,
      build: () => 'リストの範囲外にアクセスしようとしました。インデックス（番号）はリストの長さより小さくする必要があります（最初の要素は [0] です）。' },
    { types: ['IndexError'],
      pattern: /.*/,
      build: () => '配列・リストの範囲外を指定しました。インデックスの数値を確認してください。' },

    // KeyError
    { types: ['KeyError'],
      pattern: /(.+)/,
      build: m => `辞書（dict）にキー ${m[1]} が存在しません。キーのスペルを確認してください。` },

    // ZeroDivisionError
    { types: ['ZeroDivisionError'],
      pattern: /.*/,
      build: () => '0（ゼロ）で割り算しようとしました。分母が 0 になっていないか確認してください。' },

    // ImportError / ModuleNotFoundError
    { types: ['ImportError', 'ModuleNotFoundError'],
      pattern: /No module named '(.+?)'/,
      build: m => `ライブラリ「${m[1]}」が見つかりません。このノートブックで使えるライブラリか確認してください。使える主なもの: numpy, pandas, matplotlib, sklearn, PIL, math, random` },

    // AttributeError
    { types: ['AttributeError'],
      pattern: /'(.+?)' object has no attribute '(.+?)'/,
      build: m => `「${m[1]}」型のオブジェクトに「${m[2]}」という属性・メソッドはありません。スペルを確認してください。` },
    { types: ['AttributeError'],
      pattern: /module '(.+?)' has no attribute '(.+?)'/,
      build: m => `モジュール「${m[1]}」に「${m[2]}」という関数・属性はありません。スペルを確認してください。` },

    // ValueError
    { types: ['ValueError'],
      pattern: /invalid literal for int\(\)/,
      build: () => '文字列を整数に変換できません。数字だけからなる文字列か確認してください。例: int("abc") はエラーになります。' },
    { types: ['ValueError'],
      pattern: /could not convert string to float/,
      build: () => '文字列を小数に変換できません。数値のみの文字列か確認してください。' },
    { types: ['ValueError'],
      pattern: /.*/,
      build: () => '値が正しくありません。データの内容や形式を確認してください。' },

    // RecursionError
    { types: ['RecursionError'],
      pattern: /.*/,
      build: () => '関数が深く呼び出されすぎました（再帰が無限ループになっている可能性があります）。再帰処理の終了条件を確認してください。' },

    // MemoryError
    { types: ['MemoryError'],
      pattern: /.*/,
      build: () => 'メモリが不足しています。より小さなデータで試してみてください。' },

    // FileNotFoundError
    { types: ['FileNotFoundError'],
      pattern: /.*/,
      build: () => 'ファイルが見つかりません。このノートブックではファイルの読み書きはできません。' },

    // SystemExit
    { types: ['SystemExit'],
      pattern: /.*/,
      build: () => 'プログラムが終了しました（sys.exit() が呼ばれました）。' },

    // StopIteration
    { types: ['StopIteration'],
      pattern: /.*/,
      build: () => 'イテレータの要素がなくなりました。next() の使い方を確認してください。' },

    // RuntimeError
    { types: ['RuntimeError'],
      pattern: /.*/,
      build: () => '実行時エラーが発生しました。コードを見直してみてください。' },
  ];

  for (const rule of rules) {
    if (rule.types.includes(type)) {
      const m = msg ? msg.match(rule.pattern) : null;
      if (m) return rule.build(m);
    }
  }

  return 'エラーが発生しました。エラーメッセージをよく読んで、コードを確認してみましょう。わからなければ先生や友達に聞いてみよう！';
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
