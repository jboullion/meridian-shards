// Visits to m59-shards.com, from Cloudflare Web Analytics through its GraphQL Analytics API, for
// the Shards Console (ADR 0031 decision 3). Prints one JSON object: visits and page views today,
// over the last 7 days, and per day.
//
//   node tools/console/analytics.ts          (npm run console:visits)
//   node tools/console/analytics.ts --sites  the account's Web Analytics sites and their site tags,
//                                            for CLOUDFLARE_SITE_TAG (needs only the other two)
//
// .env needs CLOUDFLARE_API_TOKEN (a token with Account > Account Analytics > Read),
// CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_SITE_TAG (the Web Analytics site: --sites lists them).
// Without them it prints { "configured": false, "missing": [...] }.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnv } from "../deploy/remote.ts";

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const KEYS = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_SITE_TAG"] as const;

export interface Visits {
  configured: boolean;
  missing?: string[];
  at?: string;
  error?: string;
  today?: { visits: number; pageViews: number };
  week?: { visits: number; pageViews: number };
  /** The last 7 days (UTC), oldest first, days without visits included */
  days?: { date: string; visits: number; pageViews: number }[];
}

interface Group {
  count: number;
  sum: { visits: number };
  dimensions: { date: string };
}

// One line: the API wants the query without newlines
const QUERY = [
  "query ($accountTag: string, $siteTag: string, $start: Date, $end: Date) { viewer { accounts(filter: { accountTag: $accountTag }) {",
  "rumPageloadEventsAdaptiveGroups(limit: 100, filter: { AND: [{ siteTag: $siteTag }, { date_geq: $start }, { date_leq: $end }] }, orderBy: [date_ASC]) {",
  "count sum { visits } dimensions { date } } } } }",
].join(" ");

const day = (d: Date) => d.toISOString().slice(0, 10);

type Answer<T> = { data?: { viewer?: { accounts?: T[] } }; errors?: { message: string }[] | null };

/** One GraphQL query on the account; the account's part of the answer, or why there is none */
async function graphql<T>(env: Record<string, string | undefined>, query: string, variables: Record<string, unknown>): Promise<{ account?: T; error?: string }> {
  let body: Answer<T>;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { accountTag: env.CLOUDFLARE_ACCOUNT_ID, ...variables } }),
      signal: AbortSignal.timeout(20_000),
    });
    body = (await res.json()) as Answer<T>;
    if (!res.ok && !body.errors?.length) return { error: `HTTP ${res.status}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (body.errors?.length) return { error: body.errors.map((e) => e.message).join("; ") };
  return { account: body.data?.viewer?.accounts?.[0] };
}

const env = () => ({ ...readEnv(), ...process.env }) as Record<string, string | undefined>;

export async function visits(): Promise<Visits> {
  const e = env();
  const missing = KEYS.filter((k) => !e[k]);
  if (missing.length) return { configured: false, missing };

  const end = new Date();
  const start = new Date(end.getTime() - 6 * 86_400_000);
  const at = end.toISOString();
  const { account, error } = await graphql<{ rumPageloadEventsAdaptiveGroups?: Group[] }>(e, QUERY, { siteTag: e.CLOUDFLARE_SITE_TAG, start: day(start), end: day(end) });
  if (error) return { configured: true, at, error };
  const groups = account?.rumPageloadEventsAdaptiveGroups ?? [];
  const byDate = new Map(groups.map((g) => [g.dimensions.date, { visits: g.sum.visits, pageViews: g.count }]));
  const days: NonNullable<Visits["days"]> = [];
  for (let t = start.getTime(); day(new Date(t)) <= day(end); t += 86_400_000) {
    const date = day(new Date(t));
    days.push({ date, ...(byDate.get(date) ?? { visits: 0, pageViews: 0 }) });
  }
  const total = (list: typeof days) => ({ visits: list.reduce((n, d) => n + d.visits, 0), pageViews: list.reduce((n, d) => n + d.pageViews, 0) });
  return { configured: true, at, today: total(days.slice(-1)), week: total(days), days };
}

// Page views over the last 30 days by site, for --sites
const SITES_QUERY = [
  "query ($accountTag: string, $start: Date, $end: Date) { viewer { accounts(filter: { accountTag: $accountTag }) {",
  "rumPageloadEventsAdaptiveGroups(limit: 100, filter: { AND: [{ date_geq: $start }, { date_leq: $end }] }, orderBy: [count_DESC]) {",
  "count dimensions { siteTag requestHost } } } } }",
].join(" ");

/** The account's Web Analytics sites seen in the last 30 days: each site tag, its hosts and page views */
export async function sites(): Promise<{ sites?: { siteTag: string; hosts: string[]; pageViews: number }[]; missing?: string[]; error?: string }> {
  const e = env();
  const missing = KEYS.filter((k) => k !== "CLOUDFLARE_SITE_TAG" && !e[k]);
  if (missing.length) return { missing };
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 86_400_000);
  const { account, error } = await graphql<{ rumPageloadEventsAdaptiveGroups?: { count: number; dimensions: { siteTag: string; requestHost: string } }[] }>(e, SITES_QUERY, { start: day(start), end: day(end) });
  if (error) return { error };
  const bySite = new Map<string, { siteTag: string; hosts: string[]; pageViews: number }>();
  for (const g of account?.rumPageloadEventsAdaptiveGroups ?? []) {
    const site = bySite.get(g.dimensions.siteTag) ?? { siteTag: g.dimensions.siteTag, hosts: [], pageViews: 0 };
    if (!site.hosts.includes(g.dimensions.requestHost)) site.hosts.push(g.dimensions.requestHost);
    site.pageViews += g.count;
    bySite.set(site.siteTag, site);
  }
  return { sites: [...bySite.values()].sort((a, b) => b.pageViews - a.pageViews) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(process.argv.includes("--sites") ? await sites() : await visits(), null, 2));
}
