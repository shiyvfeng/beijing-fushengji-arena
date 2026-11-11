import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BenchPage } from "./BenchPage";
import "./bench.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BenchPage />
  </StrictMode>,
);
