import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/App";
import "@xterm/xterm/css/xterm.css";
import "@/index.css";
import { applyTheme, watchSystemTheme } from "@/state/theme";
import { connect } from "@/state/terminals";

applyTheme();
watchSystemTheme();
connect();

createRoot(document.querySelector("#root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
