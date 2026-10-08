import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { ConfigEnv, UserConfig } from "vite";

/** Keep browser fixtures and the Electron renderer on the same build settings. */
export function rendererConfig({ command }: ConfigEnv): UserConfig {
	return {
		base: command === "build" ? "./" : "/",
		plugins: [react()],
		resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
		build: { target: "esnext" },
	};
}
