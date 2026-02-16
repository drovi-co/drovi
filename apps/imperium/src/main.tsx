import ReactDOM from "react-dom/client";
import { ImperiumApp } from "./app";
import "./index.css";
import "@memorystack/imperium-design-tokens/imperium.css";

const rootElement = document.getElementById("app");
if (!rootElement) {
  throw new Error("Root element not found");
}

const root = ReactDOM.createRoot(rootElement);
root.render(<ImperiumApp />);
