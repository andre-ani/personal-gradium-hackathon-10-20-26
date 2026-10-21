<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

The manual OpenWiki GitHub Actions workflow can refresh the repository wiki on demand. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->

## Post-hackathon development boundary

- Work in `post-hackathon` or a feature branch based on it. The default `main` branch is the frozen submission, not a merge target for ongoing development.
- Preserve the immutable `hackathon-submission` release at `fcf4a10d47eb2cd119c8bcc85eef9555b0c03d89`. Never rewrite its history, move its tag, or change its published assets.
- The judging Vercel project `personal-gradium-hackathon-10-20-26` and Railway project `thread-gradium` / production service `thread` are frozen. Do not upload, redeploy, promote, re-alias, or change their production configuration for later work.
- Local previews are allowed. Before publishing improvements, use a separate preview deployment or development service and URL. Do not repoint a submitted URL.
- Label later work as post-hackathon. Preserve actual timestamps; do not imply that new work was part of the submitted snapshot.
- See `docs/post-hackathon.md` for the pinned version and judging URLs.

### Active development deployment

`thread-post-hackathon` in Railway project `thread-gradium` is the separate development service. It follows `post-hackathon` automatically and is available at https://thread-post-hackathon-production.up.railway.app/. Publishing to this branch deploys the development service; the submitted service named `thread` and both submitted URLs remain frozen. Target service IDs explicitly when using Railway; do not rely on a previously linked checkout's production service.
