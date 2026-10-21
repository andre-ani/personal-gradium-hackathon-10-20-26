# Post-hackathon development

The owner identified commit `fcf4a10d47eb2cd119c8bcc85eef9555b0c03d89` as the submitted baseline. The snapshot was labeled afterward; original commit timestamps remain unchanged. This document does not assert deadline eligibility.

## Frozen submission

- Source: [Hackathon submission](https://github.com/andre-ani/personal-gradium-hackathon-10-20-26/releases/tag/hackathon-submission), an immutable release.
- `main` remains the default branch at the baseline and has an active ruleset preventing updates, deletion, and force pushes.
- Submitted Vercel URL: https://personal-gradium-hackathon-10-20-26.vercel.app/
- Version-specific Vercel URL: https://personal-gradium-hackathon-10-20-26-8d2qc9e8m.vercel.app/
- Railway URL: https://thread-production-db1e.up.railway.app/
- Vercel production remains tied to `main`. Railway's current service has no connected Git source; it was uploaded manually.

Do not redeploy these sites or change their aliases for ongoing development. Version-specific URLs preserve deployment identity, not perpetual hosting availability.

## Continued work

Use `post-hackathon`, based on the exact submission commit. The README banner labels this work separately. Use feature branches based on this branch if useful; do not merge later work into `main` during judging.

Run local previews with the existing commands in README.md. Secrets remain in the owner's original local `.env`; no secret values are copied into this branch or documentation.

For hosted improvements, create a distinct development service or preview URL. A Vercel preview is not a verified voice runtime: the submitted code uses two WebSockets with shared in-memory state and was also packaged for a single Railway process. Preserve the framework and deployment requirements when preparing a future preview.

The previous Vercel adaptation and original artwork edits remain in their existing dirty checkouts. This clean branch intentionally starts from the owner-selected baseline; reconcile any desired changes explicitly rather than copying them over wholesale.
