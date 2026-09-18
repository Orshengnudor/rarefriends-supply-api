# $RAREFRIENDS supply API

Total, circulating and burned supply for the RF token (`0x0779369854d3EcdEA927206718FFD7730C67B71f`)
on Robinhood Chain (chain id 4663), read live from the token contract with `eth_call`.

| Endpoint | Returns |
| --- | --- |
| `/api/circulating-supply` | `{"result":"<decimal>"}` — total supply minus excluded holders |
| `/api/total-supply` | `{"result":"<decimal>"}` — on-chain `totalSupply()`, net of burns |
| `/api/burned-supply` | `{"result":"<decimal>"}` — launch supply minus total supply |
| `/api/supply` | full breakdown: block height, per-holder balances, burn percentage |

All values carry 18 decimal places. No authentication, CORS open to `*`, 60-second cache.
`/` serves the public information page.

## Deploy

```bash
npm i -g vercel
vercel login
vercel --prod
```

Then set the two environment variables (Production + Preview) and redeploy:

```bash
vercel env add RPC_URL_PRIMARY
vercel env add RPC_URL_FALLBACK
```

`RPC_URL_PRIMARY` is the public Robinhood RPC (`https://rpc.mainnet.chain.robinhood.com`).
`RPC_URL_FALLBACK` is your keyed RPC (Alchemy), used automatically when the public one fails —
store it as a Secret. Either way the key stays server-side; it is never exposed to the browser.

Point a real domain (e.g. `api.rarefriends.com`) at the project before submitting the endpoints
anywhere — HTTP-only or preview hosts get rejected by listing reviews.

## Local run

```bash
cp .env.example .env   # add your RPC key
vercel dev
```

## How supply is calculated

- `totalSupply()` is read at the latest block. The token burns for real, so burns are already
  reflected there; nothing is parked at `0x0` or `0xdead`.
- Burned = 1,024,000,000 (launch supply) − `totalSupply()`.
- Circulating = `totalSupply()` − balances of the excluded holders listed in
  `api/lib/supply.ts` (`HOLDERS`). Flip `excluded` on an entry to change what circulating
  means; the page and every endpoint follow that one array.
- Results are cached for 60 seconds. If both RPCs fail, the last good read is served rather than
  an error, so a crawler never sees a 5xx.
