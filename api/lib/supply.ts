/**
 * $RAREFRIENDS (RF) supply reader, Robinhood Chain (chain id 4663).
 *
 * Framework-free on purpose: the Hono/oRPC routes in this repo and the
 * standalone serverless function in the deploy bundle both import this file,
 * so the page, the API and any other host can never report different numbers.
 *
 * Everything is a raw eth_call against the token contract. No indexer, no
 * database, no trusted third party, anyone can rerun the calls below.
 */

export const TOKEN_ADDRESS = "0x0779369854d3EcdEA927206718FFD7730C67B71f";
export const CHAIN_ID = 4663;
export const CHAIN_NAME = "Robinhood Chain";
export const EXPLORER = "https://explorer.mainnet.chain.robinhood.com";

/** Fixed supply minted at launch, before any burns. */
export const LAUNCH_SUPPLY = 1_024_000_000n;

export const DECIMALS = 18;

/** Cache window in ms, CoinGecko polls every ~30 min, this keeps RPC load flat. */
const CACHE_TTL = 60_000;

const FALLBACK_RPC = "https://rpc.mainnet.chain.robinhood.com";

export interface HolderConfig {
  /** Label shown on the information page. */
  name: string;
  address: string;
  /** true → balance is subtracted from circulating supply. */
  excluded: boolean;
  /** Why it is (or is not) excluded, shown on the page, used in listing reviews. */
  note: string;
}

/**
 * Non-circulating holders. Flip `excluded` to change what circulating supply
 * means, it is the only place that decision lives.
 */
export const HOLDERS: HolderConfig[] = [
  {
    name: "Genesis Reserve",
    address: "0xA850B2499c064900EfF341745807e1cB0d71a52b",
    excluded: true,
    note: "Protocol-owned reserve. Never sold or distributed to the market; RF leaves it only against a fee that is routed to rewards.",
  },
  {
    name: "ActivationManager",
    address: "0xD4A35e11318E3679168d409184B788bcF9F283Ac",
    excluded: false,
    note: "Undistributed reward stream held by the contract. Counted as circulating today; monitored so a listing analyst can see it.",
  },
  {
    name: "CCA",
    address: "0x0af64eC6f2Cf0A499411eeB428bA8A9AcD0E05fA",
    excluded: false,
    note: "Protocol accounting contract. Small balance, counted as circulating.",
  },
];

/** Address holding non-circulating inventory for both the token and the NFTs. */
export const RESERVE_ADDRESS = "0xA850B2499c064900EfF341745807e1cB0d71a52b";

/**
 * RF released by the reserve per Genesis it takes in. The reserve opened with
 * the entire 1,024,000,000 RF launch supply and no NFTs, so this rate is what
 * ties the two sides together: reserveGenesis * 1,000,000 + reserveRF always
 * equals the launch supply. `reserveInvariantHolds` checks it on every read.
 */
export const RF_PER_GENESIS = 1_000_000n;

export interface NftCollectionConfig {
  key: "genesis" | "generations";
  name: string;
  address: string;
  /** Hard cap where the contract enforces one, null when the supply is open. */
  maxSupply: number | null;
  note: string;
}

/**
 * The two Rare Friends collections. Both are ERC-721 without Enumerable, so
 * minted count comes from totalMinted() rather than totalSupply().
 */
export const NFT_COLLECTIONS: NftCollectionConfig[] = [
  {
    key: "genesis",
    name: "Rare Friends Genesis",
    address: "0x116EaA62241751E0c98dA43d458600c6C17cD361",
    maxSupply: 1024,
    note: "Founding collection, capped at 1,024 and fully minted. Genesis held by the reserve is out of circulation: it re-enters only when a holder swaps in a replacement Genesis, which keeps the reserve count flat.",
  },
  {
    key: "generations",
    name: "Rare Friends Generations",
    address: "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D",
    maxSupply: null,
    note: "Open collection, no cap. Minted on demand when a holder hardwires a Friend.",
  },
];

/* ------------------------------------------------------------------ *
 * JSON-RPC
 * ------------------------------------------------------------------ */

interface RpcCall {
  method: string;
  params: unknown[];
}

function endpoints(): string[] {
  const primary = process.env.RPC_URL_PRIMARY?.trim();
  const fallback = process.env.RPC_URL_FALLBACK?.trim() || FALLBACK_RPC;
  return [primary, fallback].filter((u): u is string => Boolean(u));
}

async function batch(calls: RpcCall[]): Promise<string[]> {
  const body = JSON.stringify(
    calls.map((call, i) => ({ jsonrpc: "2.0", id: i + 1, ...call })),
  );

  let lastError: unknown;
  for (const url of endpoints()) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const json = (await res.json()) as
        | { id: number; result?: string; error?: { message: string } }[]
        | { error?: { message: string } };

      if (!Array.isArray(json)) {
        throw new Error(json.error?.message ?? "malformed RPC response");
      }
      const out: string[] = [];
      for (const entry of json.sort((a, b) => a.id - b.id)) {
        if (entry.error) throw new Error(entry.error.message);
        out.push(entry.result ?? "0x0");
      }
      if (out.length !== calls.length) throw new Error("short RPC response");
      return out;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `all RPC endpoints failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/** ERC-20 selectors, left-padded address argument. */
const SELECTOR_TOTAL_SUPPLY = "0x18160ddd";
const SELECTOR_BALANCE_OF = "0x70a08231";
/** ERC-721 mint counter. Neither collection implements Enumerable. */
const SELECTOR_TOTAL_MINTED = "0xa2309ff8";

function balanceOfData(address: string): string {
  return SELECTOR_BALANCE_OF + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/**
 * Wei-style integer → decimal string with all 18 decimal places, which is the
 * format CoinGecko's own reference endpoints return.
 */
export function formatUnits(value: bigint, decimals = DECIMALS): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/* ------------------------------------------------------------------ *
 * Snapshot
 * ------------------------------------------------------------------ */

export interface HolderSnapshot extends HolderConfig {
  /** Raw base-unit balance as a string (bigint is not JSON-serialisable). */
  raw: string;
  balance: string;
}

export interface NftCollectionSnapshot extends NftCollectionConfig {
  /** Every token ever minted. Nothing is burned in either collection. */
  totalSupply: number;
  /** Held by the Genesis reserve, therefore out of circulation. */
  reserveHeld: number;
  /** totalSupply minus reserveHeld. */
  circulatingSupply: number;
}

export interface NftSnapshot {
  chain: { name: string; id: number };
  blockNumber: number;
  reserveAddress: string;
  collections: NftCollectionSnapshot[];
  /**
   * reserveGenesis * 1,000,000 RF + reserve RF balance, which must equal the
   * 1,024,000,000 launch supply. False means the two sides have diverged and
   * the numbers should not be trusted.
   */
  reserveInvariantHolds: boolean;
  updatedAt: string;
  stale: boolean;
}

export interface SupplySnapshot {
  token: { address: string; symbol: string; decimals: number };
  chain: { name: string; id: number };
  blockNumber: number;
  launchSupply: string;
  totalSupply: string;
  circulatingSupply: string;
  burnedSupply: string;
  burnedPercent: string;
  excludedTotal: string;
  holders: HolderSnapshot[];
  /** The NFT side of the same read, so one request covers both. */
  nft: NftSnapshot;
  updatedAt: string;
  /** true when the RPC is unreachable and the last good read is being served. */
  stale: boolean;
}

let cache: { snapshot: SupplySnapshot; at: number } | null = null;
let inflight: Promise<SupplySnapshot> | null = null;

async function read(): Promise<SupplySnapshot> {
  const results = await batch([
    { method: "eth_blockNumber", params: [] },
    { method: "eth_call", params: [{ to: TOKEN_ADDRESS, data: SELECTOR_TOTAL_SUPPLY }, "latest"] },
    ...HOLDERS.map((holder) => ({
      method: "eth_call",
      params: [{ to: TOKEN_ADDRESS, data: balanceOfData(holder.address) }, "latest"],
    })),
    // NFT side: minted count and reserve holding for each collection.
    ...NFT_COLLECTIONS.flatMap((collection) => [
      {
        method: "eth_call",
        params: [{ to: collection.address, data: SELECTOR_TOTAL_MINTED }, "latest"],
      },
      {
        method: "eth_call",
        params: [{ to: collection.address, data: balanceOfData(RESERVE_ADDRESS) }, "latest"],
      },
    ]),
  ]);

  const blockNumber = Number(BigInt(results[0]!));
  const totalSupply = BigInt(results[1]!);

  const holders: HolderSnapshot[] = HOLDERS.map((holder, i) => {
    const raw = BigInt(results[i + 2]!);
    return { ...holder, raw: raw.toString(), balance: formatUnits(raw) };
  });

  const nftOffset = 2 + HOLDERS.length;
  const collections: NftCollectionSnapshot[] = NFT_COLLECTIONS.map((collection, i) => {
    const minted = Number(BigInt(results[nftOffset + i * 2]!));
    const reserveHeld = Number(BigInt(results[nftOffset + i * 2 + 1]!));
    return {
      ...collection,
      totalSupply: minted,
      reserveHeld,
      circulatingSupply: minted - reserveHeld,
    };
  });

  // Cross-check the two sides of the reserve against the launch supply.
  const reserveRf = holders.find(
    (holder) => holder.address.toLowerCase() === RESERVE_ADDRESS.toLowerCase(),
  );
  const reserveGenesis = BigInt(collections.find((c) => c.key === "genesis")?.reserveHeld ?? 0);
  const scale = 10n ** BigInt(DECIMALS);
  const reserveInvariantHolds =
    reserveRf !== undefined &&
    reserveGenesis * RF_PER_GENESIS * scale + BigInt(reserveRf.raw) === LAUNCH_SUPPLY * scale;

  const excluded = holders
    .filter((holder) => holder.excluded)
    .reduce((sum, holder) => sum + BigInt(holder.raw), 0n);

  const circulating = totalSupply - excluded;
  const burned = LAUNCH_SUPPLY * 10n ** BigInt(DECIMALS) - totalSupply;
  const burnedBps = burned <= 0n ? 0n : (burned * 10_000n) / (LAUNCH_SUPPLY * 10n ** BigInt(DECIMALS));

  return {
    token: { address: TOKEN_ADDRESS, symbol: "RF", decimals: DECIMALS },
    chain: { name: CHAIN_NAME, id: CHAIN_ID },
    blockNumber,
    launchSupply: formatUnits(LAUNCH_SUPPLY * 10n ** BigInt(DECIMALS)),
    totalSupply: formatUnits(totalSupply),
    circulatingSupply: formatUnits(circulating < 0n ? 0n : circulating),
    burnedSupply: formatUnits(burned < 0n ? 0n : burned),
    burnedPercent: (Number(burnedBps) / 100).toFixed(2),
    excludedTotal: formatUnits(excluded),
    holders,
    nft: {
      chain: { name: CHAIN_NAME, id: CHAIN_ID },
      blockNumber,
      reserveAddress: RESERVE_ADDRESS,
      collections,
      reserveInvariantHolds,
      updatedAt: new Date().toISOString(),
      stale: false,
    },
    updatedAt: new Date().toISOString(),
    stale: false,
  };
}

/**
 * Cached snapshot. Concurrent callers share one RPC round-trip, and if the
 * chain is unreachable the last good read is returned with `stale: true`
 * rather than an error, a listing crawler must never see a 5xx.
 */
export async function getSupply(): Promise<SupplySnapshot> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.snapshot;
  if (inflight) return inflight;

  inflight = read()
    .then((snapshot) => {
      cache = { snapshot, at: Date.now() };
      return snapshot;
    })
    .catch((error) => {
      if (cache) {
        const last = cache.snapshot;
        return { ...last, stale: true, nft: { ...last.nft, stale: true } };
      }
      throw error;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
