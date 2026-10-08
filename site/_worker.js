// Cloudflare Pages answers byte-range requests with the whole file, and
// Safari (iOS especially) will not play <video> without them. Only the demo
// videos come through here (see _routes.json); everything else is served by
// Pages directly.
export default {
	async fetch(request, env) {
		const range = request.headers.get("Range");
		if (!range || (request.method !== "GET" && request.method !== "HEAD")) {
			return withAcceptRanges(await env.ASSETS.fetch(request));
		}
		const url = new URL(request.url);
		const full = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
		if (full.status !== 200) return full;
		const body = await full.arrayBuffer();
		const size = body.byteLength;
		const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
		let start;
		let end;
		if (match && match[1] !== "") {
			start = Number(match[1]);
			end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
		} else if (match && match[2] !== "") {
			start = Math.max(0, size - Number(match[2]));
			end = size - 1;
		}
		const headers = new Headers(full.headers);
		headers.set("Accept-Ranges", "bytes");
		if (start === undefined || start > end || start >= size) {
			headers.set("Content-Range", `bytes */${size}`);
			headers.delete("Content-Length");
			return new Response(null, { status: 416, headers });
		}
		headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
		headers.set("Content-Length", String(end - start + 1));
		return new Response(request.method === "HEAD" ? null : body.slice(start, end + 1), { status: 206, headers });
	},
};

function withAcceptRanges(response) {
	if (response.status !== 200) return response;
	const headers = new Headers(response.headers);
	headers.set("Accept-Ranges", "bytes");
	return new Response(response.body, { status: response.status, headers });
}
