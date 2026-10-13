import ReactDOM from "react-dom/client";
import { StrictMode } from "react";
import App from "@/App";
import { AppDecorator } from "@comp/AppDecorator.js";
import { createTheme } from "@/theme.js";
import "@/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <AppDecorator {...{ createTheme }}>
      <App />
    </AppDecorator>
  </StrictMode>
);