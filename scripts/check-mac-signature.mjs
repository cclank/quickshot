import { verifyReleaseSignature } from "./mac-signing-policy.mjs";

// Checks that release builds carry the release certificate (CI runs it after
// signing): node scripts/check-mac-signature.mjs release/*/mac*/QuickShot.app
const apps = process.argv.slice(2);
if (!apps.length) {
	console.error("Usage: node scripts/check-mac-signature.mjs <QuickShot.app>...");
	process.exit(2);
}
for (const app of apps) console.log(`${app}: ${await verifyReleaseSignature(app)}`);
