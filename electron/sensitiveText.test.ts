import { describe, expect, it } from "vitest";
import {
	type MachineIdentity,
	type OcrWord,
	findSensitiveRegions,
	foldForMatching,
	lineText,
} from "./sensitiveText";

const CHAR = 10;
const LINE = 20;
const identity: MachineIdentity = {
	users: ["alex"],
	hosts: ["Alexs-MacBook-Pro.local", "Alexs-MacBook-Pro", "Alex的MacBook Pro"],
};

/** A terminal line as recognition returns it: one box per word, monospaced. */
function terminalLine(text: string, row = 0): OcrWord[] {
	return [...text.matchAll(/\S+/g)].map((match) => ({
		text: match[0],
		x: match.index * CHAR,
		y: row * 30,
		w: match[0].length * CHAR,
		h: LINE,
	}));
}

/** The line with every character whose centre is redacted shown as █. */
function redact(text: string, who: MachineIdentity = identity) {
	const { regions } = findSensitiveRegions([terminalLine(text)], who, { width: 4000, height: 100 });
	return [...text]
		.map((char, index) => {
			const x = index * CHAR + CHAR / 2;
			const covered = regions.some((r) => x > r.x && x < r.x + r.w && LINE / 2 > r.y && LINE / 2 < r.y + r.h);
			return covered && char !== " " ? "█" : char;
		})
		.join("");
}

describe("smart redaction", () => {
	it("covers the user and host in shell prompts", () => {
		expect(redact("alex@Alexs-MacBook-Pro ~ % cd ~/code")).toBe("████@█████████████████ ~ % cd ~/code");
		expect(redact("(base) alex@Alexs-MacBook-Pro quickshot % ls")).toBe(
			"(base) ████@█████████████████ quickshot % ls",
		);
		expect(redact("[root@web-01 ~]# uptime")).toBe("[████@██████ ~]# uptime");
		expect(redact("alex@devbox:~/src$ make")).toBe("████@██████:~/src$ make");
	});

	it("covers the user name wherever it stands alone", () => {
		expect(redact("-rw-r--r--  1 alex  staff  1067 Oct  9 13:58 AGENTS.md")).toBe(
			"-rw-r--r--  1 ████  staff  1067 Oct  9 13:58 AGENTS.md",
		);
		expect(redact("alexander and alexa are not alex")).toBe("alexander and alexa are not ████");
	});

	it("still finds names recognition misread", () => {
		expect(foldForMatching("Iex 0k")).toBe("lex ok");
		expect(redact("  1 aIex  staff")).toBe("  1 ████  staff");
	});

	it("covers only the user's folder in home paths", () => {
		expect(redact("/Users/alex/code/quickshot")).toBe("/Users/████/code/quickshot");
		expect(redact("cd /home/sam/projects")).toBe("cd /home/███/projects");
		expect(redact("PS C:\\Users\\alex\\code>")).toBe("PS C:\\Users\\████\\code>");
		expect(redact("ls /Users/Shared")).toBe("ls /Users/Shared");
	});

	it("covers this computer's names, including one with spaces", () => {
		expect(redact("Connected to Alexs-MacBook-Pro.local")).toBe("Connected to ███████████████████████");
		expect(redact("Sharing: Alex的MacBook Pro")).toBe("Sharing: ████████████ ███");
	});

	it("covers emails, IP and MAC addresses", () => {
		expect(redact("alex.dev@example.com")).toBe("████████████████████");
		expect(redact("PING 192.168.1.23 (192.168.1.23): 56 data bytes")).toBe(
			"PING ████████████ (████████████): 56 data bytes",
		);
		expect(redact("ether a4:83:e7:12:34:56")).toBe("ether █████████████████");
		expect(redact("inet6 fe80::1c2b:3cff:fe4d:5e6f%en0")).toBe("inet6 █████████████████████████████");
	});

	it("covers keys and tokens to the end of the word", () => {
		expect(redact("export OPENAI_API_KEY=sk-proj-4fJ8kQ2mZx9VbN7tLw3RyH")).toBe(
			"export OPENAI_API_KEY=██████████████████████████████",
		);
		expect(redact("gho_9aZ3kL7mQ2xV8nB4tR6yH1pD5sFøcE2wJ7uK")).toBe("████████████████████████████████████████");
		expect(redact("password: hunter22")).toBe("password: ████████");
		expect(redact("curl -H 'Authorization: Bearer abcdefghijklmnop1234'")).toBe(
			"curl -H 'Authorization: Bearer █████████████████████",
		);
		expect(redact("gh auth login --token ghx1234567890abcdef")).toBe("gh auth login --token ███████████████████");
	});

	it("leaves ordinary terminal output alone", () => {
		for (const text of [
			"Last login: Thu Oct  9 14:02:11 on ttys003",
			"npm i react@18.3.1 lodash@latest",
			"ssh -T git@github.com",
			"git@github.com: Permission denied (publickey).",
			"max_tokens: 128000",
			"OPENAI_API_KEY=$OPENAI_KEY node index.js",
			"Listening on http://127.0.0.1:5173 and 0.0.0.0",
			"use std::collections::HashMap;",
			"v22.11.0",
		]) {
			expect(redact(text)).toBe(text);
		}
	});

	it("counts short user names only in prompts and paths", () => {
		const li = { users: ["li"], hosts: [] };
		expect(redact("li@box ~ % echo li", li)).toBe("██@███ ~ % echo li");
		expect(redact("/Users/li/code", li)).toBe("/Users/██/code");
	});

	it("puts regions on the image, padded and inside it", () => {
		const { regions, kinds } = findSensitiveRegions(
			[terminalLine("alex@Alexs-MacBook-Pro ~ %", 1), terminalLine("/Users/alex", 2)],
			identity,
			{ width: 200, height: 200 },
		);
		expect(kinds.sort()).toEqual(["host", "user"]);
		expect(regions).toHaveLength(3);
		const [user, host, path] = regions;
		expect(user).toMatchObject({ kind: "user", x: 0, y: 28, h: 24 });
		expect(user.w).toBeGreaterThan(40);
		expect(user.w).toBeLessThan(48);
		expect(host.x).toBe(47);
		expect(host.x + host.w).toBe(200);
		expect(path).toMatchObject({ kind: "user", y: 58, h: 24 });
	});

	it("measures CJK characters as two columns", () => {
		// 用 and 户 take two columns each, so "alex" starts at column 5 of 9.
		const words = [{ text: "用户:alex", x: 0, y: 0, w: 90, h: 20 }];
		const { regions } = findSensitiveRegions([words], identity, { width: 200, height: 40 });
		expect(regions).toEqual([{ kind: "user", x: 47, y: 0, w: 46, h: 22 }]);
		expect(lineText([{ ...words[0], text: "用户" }, { ...words[0], text: "名" }, { ...words[0], text: "alex" }]).text).toBe(
			"用户名 alex",
		);
	});
});
