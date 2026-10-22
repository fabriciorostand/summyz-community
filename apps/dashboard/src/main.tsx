import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { startI18n } from "./i18n/store";
import { routes } from "./routes";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Application root was not found");

startI18n();

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={createBrowserRouter(routes)} />
  </StrictMode>,
);
