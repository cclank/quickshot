import { describe, expect, it } from "vitest";
import { identityFromFindIdentity } from "./mac-sign.mjs";

const hash = "04DA0BE632515E04CE46FE9BE3F36A8EE76597C6";

describe("signing identity from an imported certificate", () => {
	it("takes the self-signed identity macOS does not trust", () => {
		const output = `
Policy: Code Signing
  Matching identities
  1) ${hash} "QuickShot Local Signing" (CSSMERR_TP_NOT_TRUSTED)
     1 identities found

  Valid identities only
     0 valid identities found
`;
		expect(identityFromFindIdentity(output)).toBe(hash);
	});

	it("counts an identity listed as matching and valid once", () => {
		const output = `  1) ${hash} "QuickShot"\n     1 identities found\n\n  Valid identities only\n  1) ${hash} "QuickShot"\n`;
		expect(identityFromFindIdentity(output)).toBe(hash);
	});

	it("refuses to choose between several or none", () => {
		const other = "1111111111111111111111111111111111111111";
		expect(() => identityFromFindIdentity(`  1) ${hash} "A"\n  2) ${other} "B"\n`)).toThrow("found 2");
		expect(() => identityFromFindIdentity("     0 identities found\n")).toThrow("found 0");
	});
});
