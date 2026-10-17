import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_TOOL_STYLE } from "@/editor/presets";
import { OverlayToolbar, type OverlayToolbarProps } from "./OverlayToolbar";

vi.mock("@/lib/platform", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/platform")>()),
	PLATFORM: "darwin",
	SUPPORTS_OCR: true,
}));

beforeAll(() => {
	vi.stubGlobal("window", {
		innerWidth: 1440,
		innerHeight: 900,
		localStorage: { getItem: () => null, setItem: () => {} },
		addEventListener: () => {},
		removeEventListener: () => {},
	});
});

const noop = () => {};

function renderToolbar(overrides: Partial<OverlayToolbarProps> = {}) {
	return renderToStaticMarkup(
		<OverlayToolbar
			selection={{ x: 160, y: 120, width: 900, height: 500 }}
			tool="select"
			onToolChange={noop}
			style={DEFAULT_TOOL_STYLE}
			onStyleChange={noop}
			contextKind={null}
			hasSelection={false}
			onDelete={noop}
			onDuplicate={noop}
			canUndo={false}
			canRedo={false}
			onUndo={noop}
			onRedo={noop}
			busy={false}
			scrollMode={false}
			onCancel={noop}
			onCopy={noop}
			onOcr={noop}
			onSave={noop}
			onConfirm={noop}
			{...overrides}
		/>,
	);
}

describe("capture overlay toolbar", () => {
	it("keeps cancel, edit, OCR, save and copy in a stable order with copy as the primary action", () => {
		const html = renderToolbar();
		const cancel = html.indexOf('aria-label="Cancel capture"');
		const editText = html.indexOf(">Edit<");
		const save = html.indexOf('aria-label="Save to Downloads"');
		const ocr = html.indexOf('aria-label="Extract text"');
		const copyText = html.indexOf(">Copy<");
		const edit = html.lastIndexOf("<button", editText);
		const copy = html.lastIndexOf("<button", copyText);

		expect(cancel).toBeGreaterThan(-1);
		expect(cancel).toBeLessThan(edit);
		expect(edit).toBeLessThan(ocr);
		expect(ocr).toBeLessThan(save);
		expect(save).toBeLessThan(copy);
		expect(html.slice(copy, html.indexOf("</button>", copy))).toContain("bg-[var(--qs-primary)]");
		expect(html.slice(edit, html.indexOf("</button>", edit))).not.toContain("bg-[var(--qs-primary)]");
	});

	it("renders tool properties on a separate context row", () => {
		const html = renderToolbar({ tool: "rect", contextKind: "rect" });
		expect(html).toContain("grid max-w-[calc(100vw-32px)]");
		expect(html).toContain('data-quickshot-context-bar="inline"');
	});

	it("uses the primary action for scrolling and removes the regular copy action", () => {
		const html = renderToolbar({ scrollMode: true });
		const scrollText = html.indexOf(">Start scrolling<");
		const edit = html.lastIndexOf("<button", scrollText);
		expect(html).not.toContain(">Copy<");
		expect(html).not.toContain('aria-label="Extract text"');
		expect(html.slice(edit, html.indexOf("</button>", edit))).toContain("bg-[var(--qs-primary)]");
	});
});
