<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

The manual OpenWiki GitHub Actions workflow can refresh the repository wiki on demand. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->

## Development and deployment

- `main` is the current development and production branch. The owner ended the judging freeze on 2026-11-16 and authorized promoting the post-hackathon work.
- Preserve the immutable `hackathon-submission` release at `fcf4a10d47eb2cd119c8bcc85eef9555b0c03d89`. Never rewrite its history, move its tag, or change its published assets. Preserve actual timestamps; later work was not part of that snapshot.
- Both Railway services, `thread` and `thread-post-hackathon` in project `thread-gradium`, were taken offline on 2026-11-16 at the owner's request to stop public API usage. Both GitHub sources are disconnected, so pushes do not deploy.
- Do not reconnect sources or deploy either service without the owner's explicit authorization to bring the app back online. Target service IDs explicitly; do not rely on a previously linked checkout.
- Use one process and one replica: WebSockets share memory-only graph sessions. Read `docs/deploy-handoff.md` before changing deployment configuration.
- Public live use currently has no authentication, visitor quota, session deadline, or application-wide spending budget. Keep credentials server-side and add provider-backed spending controls before a publicity campaign.
- See `docs/post-hackathon.md` for the historical submission and current deployment arrangement.
