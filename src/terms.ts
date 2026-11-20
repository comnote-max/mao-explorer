import { t } from "./i18n";
// 表示用語の一元管理。画面ではGitの正式名称を使わず、必ずここを通す。
export const T = {
  repository: t("フォルダ"),
  mainBranch: t("本体"),
  branch: t("下書き"),
  createBranch: t("下書きフォルダを作る"),
  commit: t("履歴保存"),
  clone: t("初回同期"),
  sync: t("同期"),
  pullRequest: t("本体へ反映依頼"),
  pullRequests: t("反映依頼"),
  merge: t("本体に反映"),
  merged: t("本体に反映済み"),
  requestChanges: t("修正を依頼"),
  login: t("GitHubに接続"),
  logout: t("接続を解除"),
  cloud: "GitHub",
  public: t("全世界に公開"),
  private: t("招待した人だけ"),
  unsynced: t("クラウドのみ"),
  synced: t("PCと同期中"),
  localChanges: t("変更あり（履歴未保存）"),
  pending: t("送受信待ち"),
  syncing: t("同期処理中"),
  attention: t("要対応"),
  checking: t("権限確認中"),
  openInOs: t("エクスプローラーで開く"),
} as const;

/** マウスを合わせたときの説明。先頭に Git の正式名称を付けて、知っている人にも分かるようにする。 */
const help = (git: string, text: string) => `${git}：${t(text)}`;
export const HELP = {
  createBranch: help("branch", "本体のコピーを作って、失敗しても本体に影響しない下書きスペースを作ります。コピーフォルダのようなものです"),
  branchFrom: help("branch", "この下書きの履歴保存済みの内容をコピーして、新しい下書きスペースを作ります"),
  sync: help("commit + push / pull", "PCとクラウドを同じ内容にそろえます。PCの変更は履歴に記録してクラウドへ送り（ほかの人にも見えるようになります）、クラウドの最新の内容（ほかの人の変更）はPCに受け取ります"),
  saveWithMemo: help("commit + push", "送るファイルを選んだり、何を変えたかのメモを付けたりしてクラウドへ送ります"),
  commitOnly: help("commit", "クラウドへは送らず、このPCの履歴にだけ記録します。あとで「同期」すると送られます"),
  history: help("log / revert", "これまでの履歴保存の一覧を見て、昔の状態に戻せます"),
  pullRequest: help("pull request", "下書きの内容を本体に入れてもらうよう、責任者にお願いを出します"),
  merge: help("merge", "下書きの内容を本体に取り込みます。本体が下書きと同じ内容に更新されます"),
  incoming: help("pull request", "ほかの人から届いた反映依頼を確認して、取り込むか差し戻すかを決めます"),
  outgoing: help("pull request", "自分が出した反映依頼の状況を見ます"),
  requestChanges: help("request changes", "取り込まずに、直してほしい点を依頼者に伝えます"),
  clone: help("clone", "クラウドのフォルダをPCに丸ごと取り込んで、編集できるようにします"),
  members: help("collaborators", "このフォルダを見られる人の一覧と、人の招待"),
  commit: help("commit", "選んだファイルを commit します（push はしません）"),
  pull: help("pull", "origin の新しい commit を取り込みます（fetch して fast-forward / rebase）"),
  push: help("push", "まだ送っていない commit を origin に push します"),
} as const;

export const ACCESS_LABEL = { read: t("閲覧のみ"), write: t("作業・依頼可"), admin: t("管理者") } as const;
export const CHANGE_LABEL: Record<string, string> = {
  added: t("追加"), modified: t("変更"), deleted: t("削除"), renamed: t("名前変更"), conflicted: t("要対応"),
};

