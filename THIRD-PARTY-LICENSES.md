# 第三者ライブラリのライセンス

PyHiroba は、以下のオープンソースソフトウェアを利用しています。各ライブラリの著作権は各権利者に帰属します。

| ライブラリ | ライセンス | 配布元 |
| --- | --- | --- |
| Pyodide | Mozilla Public License 2.0 | https://github.com/pyodide/pyodide |
| Panel | BSD 3-Clause License | https://github.com/holoviz/panel |
| Bokeh | BSD 3-Clause License | https://github.com/bokeh/bokeh |
| CodeMirror 5 | MIT License | https://github.com/codemirror/codemirror5 |
| marked | MIT License | https://github.com/markedjs/marked |
| MathJax | Apache License 2.0 | https://github.com/mathjax/MathJax |
| DOMPurify | Apache License 2.0 または MPL 2.0 | https://github.com/cure53/DOMPurify |
| Transformers.js | Apache License 2.0 | https://github.com/huggingface/transformers.js |
| ONNX Runtime Web | MIT License | https://github.com/microsoft/onnxruntime |
| library-hiroba | MIT License | https://github.com/funakoshi-takehiro/library-hiroba |

library-hiroba（`ui` と `ai`）は `py/library_hiroba/` に**同梱**している。
学校の閉域網でも `!pip install` なしで使えるようにするため。
同梱しているのは **0.6.0** で、配布元の内容を改変していない
（ライセンス本文は `py/library_hiroba/LICENSE`）。版を上げるときは配布元から取り直すこと。

## AI（言語モデル・埋め込みモデル）

プログラム実行画面（`/nb/`）で、利用者が読み込みを選んだときだけ配布元から取得され、
計算は利用者の端末の中だけで行われます。

| モデル | 作り手 | ライセンス | 配布元 |
| --- | --- | --- | --- |
| Qwen2.5（0.5B / 1.5B の instruct 版） | Alibaba Cloud | Apache License 2.0 | https://huggingface.co/Qwen |
| Qwen3（0.6B / 1.7B） | Alibaba Cloud | Apache License 2.0 | https://huggingface.co/Qwen |
| LLM-jp-3 | 国立情報学研究所 大規模言語モデル研究開発センター | Apache License 2.0 | https://huggingface.co/llm-jp |
| paraphrase-multilingual-MiniLM-L12-v2（文の埋め込み） | Sentence-Transformers（UKP Lab） | Apache License 2.0 | https://huggingface.co/sentence-transformers |

Qwen2.5 は大きさによってライセンスが異なり、3B と 72B は Apache License 2.0 ではない
（研究用途などの制限がつく）。PyHiroba では **Apache License 2.0 の 0.5B / 1.5B のみ**を扱う。
Qwen3 は 0.6B / 1.7B とも Apache License 2.0。

文の埋め込みモデル（paraphrase-multilingual-MiniLM-L12-v2）は、文章を数ベクトルに変換して
意味の近さを測る用途で、文章の生成は行わない。実際に取得する ONNX 版は Xenova による変換物
（https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2）だが、ライセンスは
元モデル（Apache License 2.0）に従う。

## フォント

| フォント | ライセンス | 配布元 |
| --- | --- | --- |
| Zen Kaku Gothic New | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Zen+Kaku+Gothic+New |
| JetBrains Mono | SIL Open Font License 1.1 | https://fonts.google.com/specimen/JetBrains+Mono |

各ライセンスの全文は、上記の配布元をご確認ください。
