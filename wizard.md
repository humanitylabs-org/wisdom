---
wizard: 0.2
id: wisdom
name: Wisdom
type: service
category: app
voice_names: ["reader", "wisdom reader", "wizard reader", "collections"]
version: 0.4.0-private.24
summary: Deep reader for imported collections, with highlights, glosses, documented API and MCP.
license: MIT
source: .
icon: static/icon-192.png
runtime:
  kind: runtipi
  config: runtipi/config.json
  compose: runtipi/docker-compose.yml
  package: source
api:
  port: 9200
  path: /api
  spec: openapi.json
mcp:
  path: /mcp
  port: 9200
  transport: streamable-http
skill: skill/SKILL.md
requires:
  models:
    ask-ai:
      label: Ask AI about a passage or chapter
      tier: standard
      tested_on: claude-sonnet-5
      swap: ask
      abilities: [text, streaming, web_search]
    look-up:
      label: Look up a word
      tier: fast
      tested_on: claude-haiku-4-5
      swap: ask
      abilities: [text, streaming]
    chapter-authoring:
      label: Write a chapter
      tier: frontier
      tested_on: claude-opus-5-5
      swap: never
recommends:
  model: claude-opus-5-5
view:
  path: /
  port: 9200
  source:
    path: static
    build: python3 tools/check_view.py
    dist: static
provides: [collection-reading, collection-import]
system: false
uses: []
needs: []
health: /healthz
---

# Wisdom

A private testing reader, populated on first install with four owner-selected collections: Steve Jobs, Tao Te Ching, Black Mirror, and Around Every Circle. Datura and Nāgārjuna are excluded, including the embedded circle-nagarjuna chapter. No reading history, highlights or requests are copied.
Your library lives in Files under `media/Wisdom`; reading progress, highlights and ratings live in
the app's own data folder and survive updates and reinstalls.

Shared library contains approved collections; My library contains personal imports and requests.
Private libraries and reading state remain on the installation through app updates.
Per-collection export is explicit, previewed and never publishes automatically.
Optional in-app request admission remains operator-configured. No microphone is shipped.
The Wizard gateway must serve the approved shared client at `/wizard-os-home/core/app-client.js`.
See README.md for the private install contract.

Private beta. The code's distribution licence needs owner approval before public listing.
API and editable-view metadata follow the open wizard-os PR24 proposal.
