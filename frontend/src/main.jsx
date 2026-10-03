import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./app/app";
import { clearApiStartupStorage } from "./services/startup-storage.js";
import "./styles/global.css";

if (__DATA_MODE__ === "api") clearApiStartupStorage();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([{ path: "*", element: <App /> }]);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Each history entry must commit so App observes it and rechecks auth. */}
      <RouterProvider router={router} useTransitions={false} />
    </QueryClientProvider>
  </React.StrictMode>,
);
