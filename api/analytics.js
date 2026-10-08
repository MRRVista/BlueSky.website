import { getSession } from "../lib/auth.js";
import { readJson, PORTFOLIO_PATH } from "../lib/store.js";
import { computeAnalytics } from "../lib/analytics.js";
import { readStore, readArchive, allAccounts } from "../lib/plaidcore.js";
import { portfolioAccount, otherBuys } from "../lib/feeds.js";
import { BALANCE_PATH } from "../lib/balance.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "Sign in to view analytics." });
  const portfolio = await readJson(PORTFOLIO_PATH);
  if (!portfolio) return res.status(404).json({ error: "No account files have been uploaded yet." });
  // Buys in the other connected investment accounts (the IRA, Roths…) count for the wash-sale check.
  try {
    const [store, archive, bal] = await Promise.all([readStore(), readArchive(), readJson(BALANCE_PATH, null)]);
    const acct = portfolioAccount(store, bal);
    const byId = Object.fromEntries(allAccounts(store).map((a) => [a.id, a]));
    portfolio._otherBuys = otherBuys(archive, acct ? acct.id : null, byId);
  } catch (e) { console.error("other buys", e.message); }
  return res.status(200).json(computeAnalytics(portfolio));
}
