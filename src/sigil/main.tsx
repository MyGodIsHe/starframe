import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SigilFigurePage from "./SigilFigurePage";
import "../styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SigilFigurePage />
  </StrictMode>,
);
