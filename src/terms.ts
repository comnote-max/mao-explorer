// 表示用語の一元管理。画面ではGitの正式名称を使わず、必ずここを通す。
export const T = {
  repository: "プロジェクトフォルダ",
  mainBranch: "本体",
  branch: "コピー",
  createBranch: "本体をコピー",
  commit: "保存",
  clone: "初回同期",
  sync: "同期",
  pullRequest: "本体へ反映依頼",
  pullRequests: "反映依頼",
  merge: "本体に反映",
  merged: "本体に反映済み",
  requestChanges: "修正を依頼",
  login: "GitHubに接続",
  logout: "接続を解除",
  public: "公開",
  private: "非公開",
  unsynced: "未同期",
  synced: "同期済み",
  localChanges: "変更あり（未保存）",
  pending: "送受信待ち",
  syncing: "同期処理中",
  attention: "要対応",
  checking: "権限確認中",
  openInOs: "エクスプローラーで開く",
} as const;

export const ACCESS_LABEL = { read: "閲覧のみ", write: "作業・依頼可", admin: "管理者" } as const;
export const CHANGE_LABEL: Record<string, string> = {
  added: "追加", modified: "変更", deleted: "削除", renamed: "名前変更", conflicted: "要対応",
};

