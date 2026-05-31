# BakBak

BakBak is a modern Discord/Telegram/WhatsApp-style communication platform starter built with Node.js, Express, Socket.IO, HTML, CSS, and JavaScript.

## Included

- Real-time channels, DMs/groups surface, typing events, message edit/delete/reactions/replies/forward/pin.
- Image, video, audio, document uploads with drag-and-drop.
- Image/video URL previews with fixed responsive preview sizing.
- Community server/channel UI, roles, events, polls, member panel, moderation/security/AI/bot surfaces.
- Responsive desktop and mobile UI inspired by WhatsApp with Discord-style servers/channels.
- PWA manifest and service worker.
- Render deployment config.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Render

Create a Render Web Service from this repo.

- Build command: `npm install`
- Start command: `npm start`
- Environment: Node

Render will also read `render.yaml`.

## GitHub Pages note

GitHub Pages can host only the static frontend. The real-time Socket.IO server needs Render or another Node host. For `https://dev-aemni.github.io/bakbak/`, use it as a static landing/client build or point it to the Render backend.

## Create zip

```bash
npm run zip
```
