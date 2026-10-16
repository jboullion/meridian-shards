// The admin dashboard (admin.html, development only): see Dashboard.tsx.

import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard.tsx";
import "./admin.css";

createRoot(document.getElementById("root")!).render(<Dashboard />);
