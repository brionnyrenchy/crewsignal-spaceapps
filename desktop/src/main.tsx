import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/print.css";
import { App } from "./App";

// Set initial theme synchronously from OS preference before first paint
if (typeof document !== "undefined") {
  const prefersLight =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches;
  document.documentElement.dataset.theme = prefersLight ? "light" : "dark";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
