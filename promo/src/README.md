# QuickShot promo video

Sources for `promo/out/QuickShot-Promo-1080p60.mp4` (85 s, 1080p60).

- **Music:** the "City Nights" Apple Loops (97 BPM, G minor) from GarageBand, arranged by `music.mjs` into 8 four-bar sections, with a hall reverb from `ir.mjs`. Apple Loops may be used royalty-free in your own audio/video projects.
- **Picture:** `promo.html` draws every frame from a single beat clock (`render(t)`), so cuts and animations land on the beat. It uses the site's demo recordings (`site/assets/video/*-zh.mp4`) as frame sequences and window captures of the demo desktop (`test-fixtures/demo/desktop.html`).

Rebuild, from a working folder:

1. `ffmpeg` the City Nights loops into `loops/City_Nights_*.wav` (48 kHz stereo float), then `node music.mjs loops .` and `node ir.mjs hall.wav`; master `music-raw.wav` to about -14 LUFS.
2. With `npm run dev:ui` running, `node windows.mjs assets` (window PNGs), copy `site/assets/icon.svg` and `raw.webp` into `assets/`, and extract each recording with `ffmpeg -i <name>-zh.mp4 -vf fps=30 clips/<name>/%05d.jpg`.
3. Serve the folder on `127.0.0.1:4401`, then `node render.mjs frames frames 60 0 85.36` (split the range across a few processes to go faster).
4. `ffmpeg -framerate 60 -i frames/%06d.jpg -i music.wav -c:v libx264 -crf 16 -pix_fmt yuv420p -c:a aac -b:a 256k out.mp4`.
