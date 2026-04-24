import React from "react";
import ReactDOM from "react-dom/client";
import AppLayout from "./app/applayout";
import "./index.css";

// Application bootstrap entry point: mount the dashboard shell and all module features.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppLayout />
  </React.StrictMode>
);
