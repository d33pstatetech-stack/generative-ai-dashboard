# syntax=docker/dockerfile:1
#
# Generative AI Dashboard — static SPA served by nginx.
# No secrets are baked into this image — only the contents of public/ are copied.
#
# Build: docker build -t generative-ai-dashboard .
# Run:   docker run --rm -p 8000:80 generative-ai-dashboard
# Open:  http://localhost:8000
#
# Note: balances, storage and history routes (/api/*) require the Worker
# backend (D1 + R2 + provider keys live server-side), so use `wrangler dev`
# (reads .dev.vars) or `wrangler deploy` for the full app.
# This image is for static preview only.
#
# Full backend: deploy to Cloudflare with `wrangler deploy` instead.

FROM nginx:alpine

# SPA assets only — .env / .dev.vars / node_modules never enter the image
COPY public/ /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
