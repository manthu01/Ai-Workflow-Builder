import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { App } from "./App";

// Note: React.StrictMode is intentionally omitted - its dev double-mount
// disconnects @xyflow/react's node ResizeObserver and nodes render invisible.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
