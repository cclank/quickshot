import { useEffect, useState } from "react";
import { PinnedScreenshot } from "./components/screenshot/PinnedScreenshot";
import { RegionSelector } from "./components/screenshot/RegionSelector";
import { ScrollCapturePanel } from "./components/screenshot/ScrollCapturePanel";
import { Settings } from "./components/settings/Settings";
import { Editor } from "./components/editor/Editor";
import { Onboarding } from "./components/onboarding/Onboarding";
import { PermissionHelper } from "./components/onboarding/PermissionHelper";

export default function App() {
	const [windowType, setWindowType] = useState("");

	useEffect(() => {
		const type =
			new URLSearchParams(window.location.search).get("windowType") || "";
		setWindowType(type);
		if (
			type === "screenshot-region" ||
			type === "screenshot-pin" ||
			type === "permission-helper" ||
			type === "scroll-capture"
		) {
			document.body.style.background = "transparent";
			document.documentElement.style.background = "transparent";
			document.getElementById("root")?.style.setProperty("background", "transparent");
		}
	}, []);

	switch (windowType) {
		case "screenshot-region":
			return <RegionSelector />;
		case "screenshot-preview":
			return <Editor />;
		case "screenshot-pin":
			return <PinnedScreenshot />;
		case "onboarding":
			return <Onboarding />;
		case "permission-helper":
			return <PermissionHelper />;
		case "scroll-capture":
			return <ScrollCapturePanel />;
		case "settings":
			return <Settings />;
		default:
			return null;
	}
}
