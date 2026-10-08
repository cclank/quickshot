import os, struct, json, sys, subprocess
root = "/Library/Audio/Apple Loops"
def kv(data):
    try:
        count = struct.unpack(">I", data[:4])[0]
        parts = data[4:].split(b"\0")
        return {parts[2*i].decode("utf-8","replace"): parts[2*i+1].decode("utf-8","replace") for i in range(count)}
    except Exception:
        return {}
out = []
for dirpath, _, files in os.walk(root):
    for name in files:
        if not name.lower().endswith(".caf"): continue
        path = os.path.join(dirpath, name)
        info = {"name": name[:-4], "path": path}
        with open(path, "rb") as f:
            if f.read(4) != b"caff": continue
            f.read(4)
            sr = None; frames = None
            while True:
                h = f.read(12)
                if len(h) < 12: break
                t, size = h[:4], struct.unpack(">q", h[4:])[0]
                if size < 0: break
                if t == b"info":
                    info.update(kv(f.read(size)))
                elif t == b"uuid":
                    info.update(kv(f.read(size)[16:]))
                elif t == b"desc":
                    d = f.read(size); sr = struct.unpack(">d", d[:8])[0]; info["sr"] = sr
                elif t == b"pakt":
                    d = f.read(size); frames = struct.unpack(">q", d[8:16])[0]; info["frames"] = frames
                else:
                    f.seek(size, 1)
            if sr and frames:
                info["seconds"] = frames / sr
        try:
            bc = int(info.get("beat count", "0") or 0)
            if bc and info.get("seconds"):
                info["bpm"] = round(bc / info["seconds"] * 60, 2)
        except ValueError:
            pass
        out.append(info)
json.dump(out, open(sys.argv[1], "w"), ensure_ascii=False, indent=1)
genres = {}
for o in out:
    g = o.get("genre", "?"); genres[g] = genres.get(g, 0) + 1
print(len(out), sorted(genres.items(), key=lambda x: -x[1]))
