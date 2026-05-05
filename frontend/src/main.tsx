import React from "react";
import ReactDOM from "react-dom/client";
import AppLayout from "./app/applayout";
import { bootstrapAuth, installAuthenticatedFetch } from "./auth/cognitoAuth";
import "./index.css";

// Application bootstrap entry point: mount the dashboard shell and all module features.
bootstrapAuth().then(() => {
  installAuthenticatedFetch();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppLayout />
    </React.StrictMode>
  );
});
