import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";
import { StatusBadge } from "./components/StatusBadge";

function App() {
  return (
    <div className="p-8 max-w-[1280px] mx-auto">
      <h1 className="text-[28px] font-bold text-neutral-900 mb-4">
        EduVibe Archive
      </h1>
      <StatusBadge status="공개" isPublic={true} />
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
