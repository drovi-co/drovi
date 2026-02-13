import ReactDOM from "react-dom/client";
import { VerticalApp } from "./app";
import "./index.css";

const construction = "construction" as const;

const rootElement = document.getElementById("app");
if (!rootElement) {
  throw new Error("Root element not found");
}

const root = ReactDOM.createRoot(rootElement);
root.render(<VerticalApp verticalId={construction} />);
