import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// 默认深色主题先于 React 渲染写入，避免首帧闪白；设置加载后会被覆盖
document.documentElement.dataset.theme = "dark";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
