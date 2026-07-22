// Vercel Cron -> GitHub. Fires the FVR live-A1 reconciler reliably (Vercel Pro
// cron is on-time, unlike GitHub's scheduled events which we measured 15-73 min
// late). Vercel invokes this on the schedules in vercel.json ("crons"), sending
// Authorization: Bearer <CRON_SECRET>. We verify it (fail closed) and then
// dispatch the workflow via the GitHub API. No secrets in code: both come from
// Vercel env vars.
//
// Env (set in the farmare-dashboard Vercel project, Production):
//   CRON_SECRET           random string; Vercel sends it as the bearer on cron calls
//   GITHUB_DISPATCH_TOKEN fine-grained PAT: repo felixdigennaro/farmare, Actions: Read+Write
//
// Manual test:  curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron-fvr

const OWNER = 'felixdigennaro';
const REPO = 'farmare';
const WORKFLOW = 'fvr_live.yml';

module.exports = async (req, res) => {
  // 1) auth — only Vercel Cron (or someone with the secret) may trigger real trades.
  //    Fail closed: if CRON_SECRET is unset, refuse everything.
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'missing GITHUB_DISPATCH_TOKEN env var' });
  }

  // 2) dispatch the reconciler (real run: dry=false). The workflow is idempotent,
  //    so extra fires are harmless no-ops.
  try {
    const gh = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'farmare-cron',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { dry: 'false' } }),
      }
    );
    if (gh.status === 204) {
      return res.status(200).json({ ok: true, dispatched: true, at: new Date().toISOString() });
    }
    const body = await gh.text();
    return res.status(502).json({ ok: false, gh_status: gh.status, body: body.slice(0, 300) });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e).slice(0, 300) });
  }
};
