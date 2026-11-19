import "./devMock";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

/** 画面の不具合で真っ白にならないよう、エラー内容を表示して再読み込みできるようにする */
class Guard extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="center">
        <h3>表示中に問題が起きました</h3>
        <pre className="pad" style={{ maxWidth: 800, whiteSpace: "pre-wrap", fontSize: 12 }}>{String(this.state.error?.stack ?? this.state.error)}</pre>
        <button className="primary" onClick={() => location.reload()}>再読み込み</button>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Guard><App /></Guard>
  </React.StrictMode>,
);
