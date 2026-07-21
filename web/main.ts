import { mount } from "svelte";
import "../assets/tailwind.css";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });

// Register the app-shell worker so the PWA is installable.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Not fatal — the app works fine without offline shell caching.
    });
  });
}
