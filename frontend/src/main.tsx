import React from "react";
import ReactDOM from "react-dom/client";
import AuthGate from "./auth/AuthGate";
import { installAuthenticatedFetch } from "./auth/cognitoAuth";
import "./index.css";

// Application bootstrap entry point: mount the dashboard shell and all module features.
installAuthenticatedFetch();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate />
  </React.StrictMode>
);
