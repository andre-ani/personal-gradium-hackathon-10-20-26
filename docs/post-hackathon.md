# Submission history and current deployment

On 2026-11-16, after the hackathon finished, the owner authorized promoting the post-hackathon improvements into `main` and the primary live demo. The judging freeze has ended; `main` is the current version again.

## Current version

- Source: `main` in [the public repository](https://github.com/andre-ani/personal-gradium-hackathon-10-20-26).
- Canonical demo: https://thread-production-db1e.up.railway.app/.
- Railway project: `thread-gradium`, environment: `production`, service: `thread` (`4cdf1f7e-65cb-415a-b47b-16cb3dc804c0`).
- Deployment source: the repository's `main` branch; pushes deploy automatically.
- One Python process and one replica, using the committed Dockerfile and wsproto. Graph and voice WebSockets share in-memory state; restarts clear maps and cached illustrations.
- The existing Vercel redirect points to the canonical Railway URL. Vercel is not the live voice runtime.

The separate `thread-post-hackathon` service (`28ded51c-d9c2-4fd9-ae7b-7cf14afa714e`) remains a preview following `post-hackathon` at https://thread-post-hackathon-production.up.railway.app/. It is not the canonical demo.

## Archived submission

The owner identified commit `fcf4a10d47eb2cd119c8bcc85eef9555b0c03d89` as the submitted baseline. The snapshot was labeled afterward; original commit timestamps remain unchanged. This document does not assert deadline eligibility.

The original source remains available through the immutable [Hackathon submission release](https://github.com/andre-ani/personal-gradium-hackathon-10-20-26/releases/tag/hackathon-submission). Never move its tag or change its published assets. `main` and the canonical live URL now include later work and no longer identify the original submission.

The original judging links were the canonical Railway URL above and https://personal-gradium-hackathon-10-20-26.vercel.app/. Preserve historical timestamps and distinguish the release from the current live demo when presenting the project.

## Sharing the demo

The public splash demonstrates the canvas without live API calls. A recording or an offline replay can show the complete experience without a viewer consuming provider credits. Interactive voice, typed graph refinement, and generated illustrations use real server-side API credentials.

The current app does not enforce authentication, visitor quotas, session deadlines, or a durable global spending budget. The origin check, response-size limits, image cache and bounded image concurrency are not spending controls. Before a publicity campaign, use an invite-protected live demo or implement bounded trials with a global allowance and provider-side budget controls. Cover Gradium, the LLM provider and image generation separately; Railway hosting limits do not set their budgets. Current provider billing limits were not verified during promotion.

Secrets stay in platform variables or the owner's ignored local `.env`. The existing dirty artwork and Vercel checkouts were not included in this promotion.
