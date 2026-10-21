import "./styles.css";
import { boot } from "./app";

const app = document.querySelector("#app");
if (!app) throw new Error("#app missing");
boot(app as HTMLElement);
