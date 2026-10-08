# Security Policy

QuickShot handles screen contents, so we treat security reports as a priority.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting ("Report a vulnerability" under the repository's **Security** tab) and include:

- the affected version and operating system,
- steps to reproduce or a proof of concept,
- the impact you observed.

We aim to acknowledge reports within a few days and will keep you updated until a fix ships.

## Design principles

- Captures, and any text in them, are processed locally and never uploaded. The only network request is one anonymous usage report per launch (a random installation ID, the app version, the OS name and version, and the CPU architecture), which can be turned off from the tray menu and is never sent by development builds.
- Renderer windows run with context isolation, without Node.js integration, and only reach the main process through the allow-listed bridge in `electron/preload.ts`.
- The main process validates the sender window and the payload of every IPC request, including PNG structure and size limits.
- Navigation and new windows are blocked outside the bundled renderer.
