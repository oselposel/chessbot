import { createRoot } from "react-dom/client";
import Trainer from "../app/page";
import "../app/globals.css";
import "../app/studio.css";
import "../app/training.css";

createRoot(document.getElementById("root")!).render(<Trainer />);
