# MAO Explorer（デスクトップ版）

Gitを知らなくても、GitHubを普通のフォルダのように扱えるファイラー。Windows / macOS 向け。
ライセンスは MIT OR Apache-2.0（Apache-2.0 の全文は公開前に `LICENSE-APACHE` として追加する）。

- 仕様のたたき台：[docs/SPEC_v1.1_draft.md](docs/SPEC_v1.1_draft.md)
- 実現性の評価：[docs/FEASIBILITY.md](docs/FEASIBILITY.md)
- PoCの設計：[docs/POC_DESIGN.md](docs/POC_DESIGN.md)

## 開発

必要なもの：Rust 1.85 以上、Node.js 20 以上。

1. GitHub で OAuth App を登録し、「Enable Device Flow」を有効にする（コールバックURLは任意の値でよい）。
2. 公式のClient IDが組み込み済み。フォーク版は環境変数 `MAO_GITHUB_CLIENT_ID` で自分の値に差し替えられる。

```sh
npm install
npm run tauri dev
```

## 構成

- `crates/mao-core`：画面に依存しない処理（GitHubログイン、今後Git処理）
- `src-tauri`：Tauri のコマンド
- `src`：React 画面。表示用語は `src/terms.ts` に集約する
