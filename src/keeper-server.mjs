// Keeper envelope-intake server. The browser signs a pre-signed envelope (sign-only) and POSTs it
// here; the server VERIFIES it (signature + intent + on-chain policy) before storing it for the
// daemon to relay. This is the transport that makes in-app "Enable autopilot" non-custodial: the
// owner's key never leaves their wallet, and the keeper never accepts unverified bytes.
import http from 'node:http';
import { verifyEnvelope, storeEnvelopeRecord, loadEnvelope } from './envelopes.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', ...CORS }); res.end(JSON.stringify(obj)); };
const log = (fields) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', ...fields }));

const readBody = (req) => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 200_000) { req.destroy(); reject(new Error('body too large')); } });
  req.on('end', () => resolve(b));
  req.on('error', reject);
});

/** Start the intake server. Returns the http.Server. */
export function startEnvelopeServer({ pkg, port = 8787 } = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, pkg });

      if (req.method === 'POST' && url.pathname === '/envelopes') {
        const rec = JSON.parse(await readBody(req));
        const v = await verifyEnvelope(rec, { pkg });
        if (!v.ok) { log({ event: 'envelope-rejected', policyId: rec?.policyId, reason: v.error }); return json(res, 400, { ok: false, error: v.error }); }
        const stored = storeEnvelopeRecord(rec);
        log({ event: 'envelope-enrolled', policyId: rec.policyId, owner: rec.owner, expiresAt: stored.expiresAt });
        return json(res, 200, { ok: true, policyId: rec.policyId, expiresAt: stored.expiresAt });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/status/')) {
        const e = loadEnvelope(decodeURIComponent(url.pathname.slice('/status/'.length)));
        return json(res, 200, { enrolled: !!e, expiresAt: e?.expiresAt ?? null });
      }

      json(res, 404, { ok: false, error: 'not found' });
    } catch (e) {
      json(res, 500, { ok: false, error: String(e.message ?? e) });
    }
  });
  server.listen(port, () => log({ event: 'envelope-server', port }));
  return server;
}
