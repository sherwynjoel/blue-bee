# Facility-linen console — screenshots (light + dark)

Real-browser screenshots (puppeteer-core + system Chrome, deviceScaleFactor 2, full-page) of the
care-home **facility-linen par loop** console surface (`/facility-linen`), branch
`feat/care-home-linen-par`. Captured signed-in as the demo **OWNER** against the seeded **Maple Grove
Care Home → West Wing**, so the numbers are the real seeded ledger (on-hand == Σ movements).

| file | what it shows |
|------|---------------|
| `pack-to-par-{light,dark}.png` | The pack-to-par load sheet: gap = max(0, par − on-hand) per SKU. The MG-WEST **wing** sheet par (50 / on-hand 30 / **pack 20**) sits distinctly from the **site-level** sheet par (120 / 82 / **pack 38**) — the cost-centre split. Total to pack **145**. The generated load sheet + the par table + the pickup feed are all visible (full-page). |
| `par-management-{light,dark}.png` | Par levels per site/wing with the **Set par** form open (SKU picker = LINEN SKUs only, cost-centre optional, target qty). |
| `soil-pickup-{light,dark}.png` | Soiled-cart pickups with the **Record pickup** form open (carts / bags / weight / cost-centre + per-SKU soiled counts), and the recorded pickup feed (4 carts · 57.40 kg · 58 pieces). |

Regenerate: start the API (`SMS_TRANSPORT=console`, `CORS_ALLOWED_ORIGINS=<web>`) + the web, then
`API_BASE=… WEB_BASE=… node apps/web/scripts/facility-linen-screenshots.mjs`.
