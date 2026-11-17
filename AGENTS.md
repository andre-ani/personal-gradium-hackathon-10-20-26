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
- The canonical Railway service is `thread` in project `thread-gradium`, production environment, connected to `main`: https://thread-production-db1e.up.railway.app/.
- `thread-post-hackathon` remains the separate preview service following `post-hackathon`. Target service IDs explicitly; do not rely on a previously linked checkout.
- Use one process and one replica: WebSockets share memory-only graph sessions. Read `docs/deploy-handoff.md` before changing deployment configuration.
- Public live use currently has no authentication, visitor quota, session deadline, or application-wide spending budget. Keep credentials server-side and add provider-backed spending controls before a publicity campaign.
- See `docs/post-hackathon.md` for the historical submission and current deployment arrangement.
