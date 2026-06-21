import { useState, useEffect } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSignTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { composePolicyFromIntent, type PolicyParams } from '../lib/guardian';
import { DEPLOYMENT, SUI_TYPE, DBUSDC_TYPE, DEMO_MANAGER, TIP_MIST, toFixedRr, suiscanTx, suiscanObj } from '../lib/deployment';
import { buildCreateManagerTx, managerIdFromEvents, getOwnedManagerIds } from '../lib/deepbook';
import { buildReserveGasTx, buildEnvelopeTx, postEnvelope, RESERVE_GAS_MIST } from '../lib/autopilot';

type ApStatus = 'idle' | 'reserving' | 'signing' | 'posting' | 'on' | 'error';

const EXAMPLES = [
  'Protect this position conservatively — I sleep 11pm–7am IST',
  'Aggressive, max leverage, but just alert me, don’t trade',
  'Balanced protection, ask me before any sell',
];

const TIER_NAME = ['Sentinel · alerts only', 'Co-pilot · one-click approve', 'Autopilot · auto-execute'];
const DEFAULT_INTENT = 'Balanced protection, autopilot — repay and de-risk before I get liquidated';
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

export function Composer() {
  const [text, setText] = useState(DEFAULT_INTENT);
  const [result, setResult] = useState<ReturnType<typeof composePolicyFromIntent> | null>(() => composePolicyFromIntent(DEFAULT_INTENT));
  const [managerId, setManagerId] = useState(DEMO_MANAGER);
  const [creating, setCreating] = useState(false);
  const [txDigest, setTxDigest] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mgrCreating, setMgrCreating] = useState(false);
  const [mgrError, setMgrError] = useState<string | null>(null);
  const [apStatus, setApStatus] = useState<ApStatus>('idle');
  const [apError, setApError] = useState<string | null>(null);

  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutate: signAndExecute, mutateAsync: signAndExecuteAsync } = useSignAndExecuteTransaction();
  const { mutateAsync: signTransaction } = useSignTransaction();

  // policy::create asserts the caller owns the (shared) MarginManager. Pre-check ownership so the
  // user gets a clear inline message instead of a wallet-level "could not be processed" abort.
  type OwnerCheck = { status: 'idle' | 'checking' | 'ok' | 'mismatch' | 'notfound' | 'badtype' | 'error'; owner?: string };
  const [ownerCheck, setOwnerCheck] = useState<OwnerCheck>({ status: 'idle' });
  useEffect(() => {
    const id = managerId.trim();
    if (!id || !account) { setOwnerCheck({ status: 'idle' }); return; }
    let cancelled = false;
    setOwnerCheck({ status: 'checking' });
    client.getObject({ id, options: { showContent: true, showType: true } })
      .then((o) => {
        if (cancelled) return;
        if (!o.data) { setOwnerCheck({ status: 'notfound' }); return; }
        if (!o.data.type?.includes('::margin_manager::MarginManager')) { setOwnerCheck({ status: 'badtype' }); return; }
        const owner = (o.data.content as any)?.fields?.owner as string | undefined;
        setOwnerCheck(owner === account.address ? { status: 'ok', owner } : { status: 'mismatch', owner });
      })
      .catch(() => { if (!cancelled) setOwnerCheck({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [managerId, account?.address, client]);

  // On connect, discover a margin manager this wallet already owns and prefill it — so a returning
  // user never gets asked to create a second one. Only replaces the demo default / empty field;
  // never clobbers a manager the user typed or just created.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    getOwnedManagerIds(client, account.address).then((ids) => {
      if (cancelled) return;
      // Replace only the demo default / empty field: own one → prefill it; own none → clear the
      // demo manager so the user just sees "create one" instead of a foreign-owner mismatch.
      setManagerId((cur) => (cur !== DEMO_MANAGER && cur.trim() ? cur : ids[0] ?? ''));
    });
    return () => { cancelled = true; };
  }, [account?.address, client]);

  const compose = (t: string) => { setText(t); setResult(composePolicyFromIntent(t)); reset(); };
  const reset = () => { setTxDigest(null); setPolicyId(null); setError(null); setApStatus('idle'); setApError(null); };

  // Build + sign the REAL guardian::policy::create call against the deployed package. The wallet
  // must own `managerId`. Mirrors the proven CLI tx (scripts/protect.mjs).
  const createPolicy = () => {
    if (!result || !account || !managerId.trim()) return;
    reset(); setCreating(true);
    const p = result.params;
    const tx = new Transaction();
    const [tip] = tx.splitCoins(tx.gas, [TIP_MIST]);
    const tipBal = tx.moveCall({ target: '0x2::coin::into_balance', typeArguments: [SUI_TYPE], arguments: [tip] });
    const policy = tx.moveCall({
      target: `${DEPLOYMENT.packageId}::policy::create`,
      typeArguments: [SUI_TYPE, DBUSDC_TYPE],
      arguments: [
        tx.object(managerId.trim()),
        tx.pure.u8(p.tier),
        tx.pure.u64(toFixedRr(p.triggerRr)),
        tx.pure.u64(toFixedRr(p.targetRr)),
        tx.pure.u64(p.minActionIntervalMs),
        tipBal,
      ],
    });
    tx.transferObjects([policy], account.address);

    signAndExecute({ transaction: tx }, {
      onSuccess: async (r) => {
        setTxDigest(r.digest); setCreating(false);
        try {
          const res = await client.waitForTransaction({ digest: r.digest, options: { showObjectChanges: true } });
          const pol = (res.objectChanges ?? []).find((c: any) => c.type === 'created' && c.objectType?.endsWith('::policy::ProtectionPolicy'));
          if (pol) setPolicyId((pol as any).objectId);
        } catch { /* digest is enough */ }
      },
      onError: (e) => { setError(e.message || 'Transaction failed'); setCreating(false); },
    });
  };

  // Permanent onboarding: mint a MarginManager the connected wallet owns, so anyone — not just the
  // dev wallet — can bind a policy. On success we auto-fill the new manager id (ownership check → ✓).
  const createManager = () => {
    if (!account) return;
    setMgrError(null); setMgrCreating(true);
    const tx = buildCreateManagerTx(client, account.address);
    signAndExecute({ transaction: tx }, {
      onSuccess: async (r) => {
        try {
          const res = await client.waitForTransaction({ digest: r.digest, options: { showEvents: true } });
          const id = managerIdFromEvents(res.events as any);
          if (id) { setManagerId(id); reset(); }
          else setMgrError('Manager created — refresh your objects and paste its id.');
        } catch { setMgrError('Manager created — confirming on-chain, paste its id if it doesn’t fill.'); }
        setMgrCreating(false);
      },
      onError: (e) => {
        const m = e.message || '';
        setMgrError(/gas|insufficient|balance|no valid/i.test(m)
          ? 'Your wallet needs a little testnet SUI for gas — get some at faucet.sui.io, then retry.'
          : (m || 'Could not create manager'));
        setMgrCreating(false);
      },
    });
  };

  // Enable autopilot: reserve a dedicated gas coin, sign an EXECUTE-ONLY envelope (sign-only), and
  // POST it to the keeper, which verifies before storing. Owner key never leaves the wallet.
  const enableAutopilot = async () => {
    if (!account || !policyId) return;
    setApError(null); setApStatus('reserving');
    try {
      const reserve = await signAndExecuteAsync({ transaction: buildReserveGasTx(account.address) });
      await client.waitForTransaction({ digest: reserve.digest });
      const coins = (await client.getCoins({ owner: account.address })).data;
      const reserved = coins.find((c) => c.balance === String(RESERVE_GAS_MIST)) ?? [...coins].sort((a, b) => Number(a.balance) - Number(b.balance))[0];
      if (!reserved) throw new Error('could not reserve a gas coin');
      const obj = await client.getObject({ id: reserved.coinObjectId });
      const gas = { objectId: obj.data!.objectId, version: String(obj.data!.version), digest: obj.data!.digest };

      setApStatus('signing');
      const tx = buildEnvelopeTx({ owner: account.address, policyId, managerId: managerId.trim(), gas });
      const signed = await signTransaction({ transaction: tx });

      setApStatus('posting');
      const out = await postEnvelope({ policyId, owner: account.address, gasObjectId: gas.objectId, txBytes: signed.bytes, signature: signed.signature, expiresAt: Date.now() + 24 * 3600_000 });
      if (out.ok) setApStatus('on');
      else { setApStatus('error'); setApError(out.error ?? 'keeper rejected the envelope'); }
    } catch (e) {
      setApStatus('error'); setApError(e instanceof Error ? e.message : 'autopilot enrollment failed');
    }
  };

  const btnLabel = txDigest ? '✓ Policy created on-chain'
    : creating ? 'Creating policy…'
    : !account ? 'Connect wallet to create'
    : !managerId.trim() ? 'Enter a margin manager'
    : ownerCheck.status === 'checking' ? 'Checking manager…'
    : ownerCheck.status === 'notfound' ? 'Manager not found on testnet'
    : ownerCheck.status === 'badtype' ? 'Not a margin manager object'
    : ownerCheck.status === 'mismatch' ? 'Connect the wallet that owns this manager'
    : ownerCheck.status === 'error' ? 'Could not read manager'
    : 'Create policy on-chain';

  return (
    <div className="page" style={{ maxWidth: 1060, margin: '0 auto' }}>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Structured policy composer · natural language → on-chain policy</div>
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
        Deterministic — your words map to <b style={{ color: 'var(--muted)' }}>parameters you confirm</b>, never actions, with no model in the loop. Every
        proposal is re-validated against the same on-chain safety envelope the contract enforces (<code>assert_thresholds</code>), so a malformed or
        injected request can’t produce an unsafe policy. <b style={{ color: 'var(--muted)' }}>Confirm</b> calls the live
        <code> guardian::policy::create</code> on testnet.
      </div>

      {result && (
        <div className="fade-in">
          {/* Two equal-height review cards */}
          <div className="row" style={{ marginTop: 4, alignItems: 'stretch' }}>
            <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="card-head"><span className="card-title">Proposed parameters</span>
                <span className="chip" style={{ background: 'var(--accent)', color: 'var(--ink)', textTransform: 'uppercase' }}>{result.preset}</span></div>
              <ParamRows p={result.params} />
              <div className="pill" style={{ marginTop: 'auto', width: '100%', justifyContent: 'flex-start',
                borderColor: result.valid ? 'var(--safe)' : 'var(--danger)', color: result.valid ? 'var(--safe)' : 'var(--danger)' }}>
                <span className="dot" style={{ background: result.valid ? 'var(--safe)' : 'var(--danger)' }} />
                {result.valid ? 'Passes the on-chain safety envelope' : result.errors.join('; ')}
              </div>
            </div>

            <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <span className="card-title">What Guardian may do</span>
              <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12 }}>
                <Permission ok text={`Act when risk ratio falls below ${result.params.triggerRr.toFixed(2)}`} />
                <Permission ok text={`Cancel open orders and repay debt from idle balance to restore RR toward ${result.params.targetRr.toFixed(2)}`} />
                <Permission ok text="Self-liquidate the instant the protocol allows it — reward returned to you, not a bot" />
                <Permission text="Move any asset to an address that isn’t yours" />
                <Permission text="Increase your debt or open new leverage" />
              </ul>
            </div>
          </div>

          {/* Full-width action bar */}
          <div className="card" style={{ marginTop: 14 }}>
            <div className="row" style={{ alignItems: 'flex-end', gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="stat-label" style={{ marginBottom: 5 }}>Margin manager <span style={{ color: 'var(--faint)', textTransform: 'none' }}>· your SUI/DBUSDC manager</span></div>
                <input className="field num" style={{ width: '100%', fontSize: 11.5, padding: '10px 11px' }} value={managerId}
                  onChange={(e) => { setManagerId(e.target.value); reset(); }} spellCheck={false} placeholder="0x…" />
              </div>
              <button className="btn btn-primary btn-lg" style={{ width: 240, flex: 'none' }}
                disabled={!result.valid || !account || creating || !managerId.trim() || !!txDigest || (!!account && ownerCheck.status !== 'ok')} onClick={createPolicy}>
                {btnLabel}
              </button>
            </div>

            <div className="row" style={{ alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 8, gap: 14 }}>
              <div style={{ fontSize: 11, lineHeight: 1.5, flex: 1, minWidth: 0 }}>
                {account && ownerCheck.status === 'ok' && <span style={{ color: 'var(--safe)' }}>✓ This wallet owns this manager</span>}
                {account && ownerCheck.status === 'mismatch' && (
                  <span style={{ color: 'var(--danger)' }}>Owned by {ownerCheck.owner ? short(ownerCheck.owner) : 'another address'} — connect that wallet, or create one below.</span>
                )}
                {account && ownerCheck.status === 'notfound' && <span style={{ color: 'var(--danger)' }}>No object with this id on testnet.</span>}
                {!account && <span style={{ color: 'var(--faint)' }}>Connect a wallet to bind a policy to your manager.</span>}
              </div>
              <span style={{ fontSize: 11, color: 'var(--faint)', flex: 'none', whiteSpace: 'nowrap' }}>Tier {result.params.tier} · {TIER_NAME[result.params.tier]}</span>
            </div>

            {account && ownerCheck.status !== 'ok' && ownerCheck.status !== 'checking' && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--line, #e5e5e5)' }}>
                <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: '9px 11px', width: '100%', fontWeight: 600 }}
                  disabled={mgrCreating} onClick={createManager}>
                  {mgrCreating ? 'Creating your manager…' : '+ Create a SUI/DBUSDC manager you own'}
                </button>
                {mgrError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6, lineHeight: 1.5, wordBreak: 'break-word' }}>{mgrError}</div>}
              </div>
            )}

            {txDigest && (
              <div className="row" style={{ marginTop: 12, gap: 10, alignItems: 'stretch' }}>
                <div className="mono-tag" style={{ flex: 1, fontSize: 11, lineHeight: 1.7, border: '1.5px solid var(--safe)', padding: '9px 11px' }}>
                  <b style={{ color: 'var(--safe)' }}>created on testnet</b> &nbsp;
                  <a href={suiscanTx(txDigest)} target="_blank" rel="noreferrer">tx {short(txDigest)} ↗</a>
                  {policyId && <> &nbsp;·&nbsp; <a href={suiscanObj(policyId)} target="_blank" rel="noreferrer">policy {short(policyId)} ↗</a></>}
                </div>
                {/* Tier-2: enable unattended autopilot via a non-custodial pre-signed envelope */}
                {policyId && result.params.tier === 2 && (
                  apStatus === 'on' ? (
                    <div className="mono-tag" style={{ flex: 1, fontSize: 11, lineHeight: 1.5, border: '1.5px solid var(--safe)', color: 'var(--safe)', padding: '9px 11px', display: 'flex', alignItems: 'center' }}>
                      ⚡ <b>&nbsp;Autopilot enabled.</b>&nbsp;Keeper deleverages you before liquidation — no further signing.
                    </div>
                  ) : (
                    <button className="btn btn-primary btn-lg" style={{ flex: 1 }}
                      disabled={apStatus === 'reserving' || apStatus === 'signing' || apStatus === 'posting'} onClick={enableAutopilot}>
                      {apStatus === 'reserving' ? 'Reserving gas…' : apStatus === 'signing' ? 'Sign the envelope…' : apStatus === 'posting' ? 'Enrolling…' : 'Enable autopilot (sign once)'}
                    </button>
                  )
                )}
              </div>
            )}
            {apError && <div className="mono-tag" style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5, border: '1.5px solid var(--danger)', color: 'var(--danger)', padding: '8px 11px', wordBreak: 'break-word' }}>{apError}</div>}
            {error && (
              <div className="mono-tag" style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5, border: '1.5px solid var(--danger)', color: 'var(--danger)', padding: '9px 11px', wordBreak: 'break-word' }}>
                {error.includes('ENotManagerOwner') || error.includes('abort') ? 'This wallet does not own that margin manager (or it isn’t SUI/DBUSDC).' : error}
              </div>
            )}
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
