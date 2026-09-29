import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/urbanist";
import "@fontsource-variable/geist-mono";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/protocol.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
