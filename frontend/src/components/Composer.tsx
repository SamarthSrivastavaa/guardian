import { useState } from 'react';
import { useCurrentAccount, useSignPersonalMessage } from '@mysten/dapp-kit';
import { composePolicyFromIntent, type PolicyParams } from '../lib/guardian';

const EXAMPLES = [
  'Protect this position conservatively — I sleep 11pm–7am IST',
  'Aggressive, max leverage, but just alert me, don’t trade',
  'Balanced protection, ask me before any sell',
];

const TIER_NAME = ['Sentinel · alerts only', 'Co-pilot · one-click approve', 'Autopilot · auto-execute'];

const DEFAULT_INTENT = 'Balanced protection, autopilot — repay and de-risk before I get liquidated';

export function Composer() {
  const [text, setText] = useState(DEFAULT_INTENT);
  const [result, setResult] = useState<ReturnType<typeof composePolicyFromIntent> | null>(() => composePolicyFromIntent(DEFAULT_INTENT));
  const [confirmed, setConfirmed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [sig, setSig] = useState<string | null>(null);

  const account = useCurrentAccount();
  const { mutate: signPersonalMessage } = useSignPersonalMessage();

  const compose = (t: string) => { setText(t); setResult(composePolicyFromIntent(t)); setConfirmed(false); setSig(null); };

  const authorize = () => {
    if (!result || !account) return;
    // Non-custodial authorization: the wallet signs the policy envelope (the exact params the
    // on-chain guardian::policy::create will use). Real signature, no custody, no fake tx —
    // the signed envelope is what a keeper broadcasts once the package is live (localnet today).
    const envelope = JSON.stringify({ kind: 'guardian.policy', owner: account.address, ...result.params });
    setSigning(true);
    signPersonalMessage(
      { message: new TextEncoder().encode(envelope) },
      {
        onSuccess: (r) => { setSig(r.signature); setConfirmed(true); setSigning(false); },
        onError: () => setSigning(false),
      },
    );
  };

  return (
    <div className="page" style={{ maxWidth: 1060, margin: '0 auto' }}>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 10 }}>AI policy composer · natural language → on-chain policy</div>
        <textarea className="field" rows={3} placeholder="Describe how Guardian should protect this position…"
          value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row" style={{ marginTop: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {EXAMPLES.map((e) => (
              <button key={e} className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 11px', fontWeight: 500 }} onClick={() => compose(e)}>{e}</button>
            ))}
          </div>
          <button className="btn btn-primary" style={{ whiteSpace: 'nowrap' }} disabled={!text.trim()} onClick={() => compose(text)}>Compose policy →</button>
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--faint)', margin: '14px 4px', lineHeight: 1.6 }}>
        The model only proposes <b style={{ color: 'var(--muted)' }}>parameters you confirm</b> — never actions. Every proposal is re-validated against the
        same on-chain safety envelope the contract enforces, so a bad or injected prompt can’t produce an unsafe policy.
      </div>

      {result && (
        <div className="row fade-in" style={{ marginTop: 4, alignItems: 'flex-start' }}>
          <div className="card" style={{ flex: 1.1 }}>
            <div className="card-head"><span className="card-title">Proposed parameters</span>
              <span className="chip" style={{ background: 'var(--accent)', color: 'var(--ink)', textTransform: 'uppercase' }}>{result.preset}</span></div>
            <ParamRows p={result.params} />
            <div className={`pill`} style={{ marginTop: 14, width: '100%', justifyContent: 'flex-start',
              borderColor: result.valid ? 'var(--safe)' : 'var(--danger)', color: result.valid ? 'var(--safe)' : 'var(--danger)' }}>
              <span className="dot" style={{ background: result.valid ? 'var(--safe)' : 'var(--danger)' }} />
              {result.valid ? 'Passes the on-chain safety envelope' : result.errors.join('; ')}
            </div>
          </div>

          <div className="card" style={{ flex: 1 }}>
            <span className="card-title">What Guardian may do</span>
            <ul style={{ listStyle: 'none', marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Permission ok text={`Act when risk ratio falls below ${result.params.triggerRr.toFixed(2)}`} />
              <Permission ok text={`Cancel orders and repay debt to restore RR toward ${result.params.targetRr.toFixed(2)}`} />
              <Permission ok text={`Sell in reduce-only tranches, capped at ${(result.params.maxSlippageBps / 100).toFixed(2)}% slippage`} />
              <Permission ok text={`Self-liquidate below ${result.params.whiteknightRr.toFixed(2)} — reward returned to you`} />
              <Permission text="Move any asset to an address that isn’t yours" />
              <Permission text="Increase your debt or open new leverage" />
            </ul>
            <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 18 }}
              disabled={!result.valid || !account || signing || confirmed} onClick={authorize}>
              {confirmed ? '✓ Policy authorized' : signing ? 'Signing…' : !account ? 'Connect wallet to sign' : 'Confirm & sign policy'}
            </button>
            {sig && (
              <div className="mono-tag" style={{ marginTop: 10, wordBreak: 'break-all', fontSize: 10, lineHeight: 1.4,
                border: '1.5px solid var(--safe)', padding: '8px 10px' }}>
                <b style={{ color: 'var(--safe)' }}>signed envelope</b> · {sig.slice(0, 44)}…
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--faint)', textAlign: 'center', marginTop: 8 }}>Tier {result.params.tier} · {TIER_NAME[result.params.tier]}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function ParamRows({ p }: { p: PolicyParams }) {
  const rows: [string, string][] = [
    ['Trigger RR', p.triggerRr.toFixed(2)],
    ['Target RR', p.targetRr.toFixed(2)],
    ['White-knight RR', p.whiteknightRr.toFixed(2)],
    ['Max slippage', `${(p.maxSlippageBps / 100).toFixed(2)}%`],
    ['Tranche size', `${(p.trancheBps / 100).toFixed(0)}%`],
    ['Min action interval', `${p.minActionIntervalMs / 1000}s`],
  ];
  return <div>{rows.map(([k, v]) => <div className="kv" key={k}><span>{k}</span><b className="num">{v}</b></div>)}</div>;
}

function Permission({ ok, text }: { ok?: boolean; text: string }) {
  return (
    <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: 'var(--text-2)' }}>
      <span style={{ color: ok ? 'var(--safe)' : 'var(--danger)', fontWeight: 700, flex: 'none', marginTop: 1 }}>{ok ? '✓' : '✕'}</span>
      <span>{text}</span>
    </li>
  );
}
