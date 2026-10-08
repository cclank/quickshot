import { defineConfig, mergeConfig } from "vite";
import { rendererConfig } from "./vite.renderer.config";

// Renderer-only dev server for iterating on the editor UI against the HTML
// fixtures in test-fixtures/. It never starts Electron or touches the screen.
export default defineConfig((environment) => mergeConfig(rendererConfig(environment), {
	server: {
		port: 5188,
		strictPort: true,
	},
}));
