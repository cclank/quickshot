import { useEffect, useState } from "react";
import { PinnedScreenshot } from "./components/screenshot/PinnedScreenshot";
import { RegionSelector } from "./components/screenshot/RegionSelector";
import { ScreenshotPreview } from "./components/screenshot/ScreenshotPreview";

export default function App() {
	const [windowType, setWindowType] = useState("");

	useEffect(() => {
		const type =
			new URLSearchParams(window.location.search).get("windowType") || "";
		setWindowType(type);
		if (type === "screenshot-region" || type === "screenshot-pin") {
			document.body.style.background = "transparent";
			document.documentElement.style.background = "transparent";
			document.getElementById("root")?.style.setProperty("background", "transparent");
		}
	}, []);

	switch (windowType) {
		case "screenshot-region":
			return <RegionSelector />;
		case "screenshot-preview":
			return <ScreenshotPreview />;
		case "screenshot-pin":
			return <PinnedScreenshot />;
		default:
			return null;
	}
}
