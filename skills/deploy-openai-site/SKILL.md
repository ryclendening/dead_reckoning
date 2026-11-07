---
name: deploy-openai-site
description: Deploy this repository to its existing ChatGPT managed Site. Use when asked to publish or deploy this project.
---

# Deploy this project

1. Read `.openai/hosting.json`, inspect `git status --short`, and confirm the requested source scope. Never create another Site or change its audience.
2. Call the native Sites `get_site` connector and verify this project is editable. Request a source credential for that Site; do not ask the user to create or paste one.
3. Start `npm run deploy:openai` in a PTY. Send the credential tool's `structuredContent` object through the hidden stdin prompt. The command runs the production build, synchronizes source, and packages it. It does not print or persist the credential.
4. Pass the helper's returned project ID, commit SHA, and archive to the native Sites publication connector. Use private deployment only when `get_site` confirms owner-only access; otherwise preserve the existing audience and use its supported deployment operation. If automatic private publishing was accepted, follow that response and do not deploy the same version twice.
5. Poll deployment status only while non-terminal and report the production URL. Do not use browser-based QA without explicit user permission.
