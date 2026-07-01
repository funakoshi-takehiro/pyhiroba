'use strict';

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

## 4. 保存・読み込み（ダウンロードとインポート）
作ったノートブックは、画面右上のボタンでいつでも保存・読み込みできます。

- **⭳ ダウンロード**：今のノートブックを \`.ipynb\` ファイルとして、自分のパソコンなどに保存します。
  作業のつづきを残したいときや、先生に提出したいときに使います。
- **⭱ インポート**：手元にある \`.ipynb\` ファイルを開いて、このPyHiroba上で編集できます。
  前回ダウンロードしたつづきや、配られたノートブックを開くときに使います。

## 5. キーボードショートカット
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

  // URLパラメータに対応したセルを追加（focus:false で視点を動かさない）
  // 読み込み中は「未保存」として数えない
  suppressDirty = true;
  lesson.cells().forEach(cell => addCell({ ...cell, focus: false }));
  suppressDirty = false;
  isDirty = false;
  // 新規/レッスンを開いた直後は必ず一番上から表示する
  window.scrollTo(0, 0);
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

