import React from "react";
import { createRoot } from "react-dom/client";
import { HomePage } from "./HomePage";
import "./home.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root mount point");
}

createRoot(root).render(
  <React.StrictMode>
    <HomePage />
  </React.StrictMode>,
);
