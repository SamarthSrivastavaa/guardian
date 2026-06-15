import { useState } from 'react';
import { useCurrentAccount, useConnectWallet, useDisconnectWallet, useWallets } from '@mysten/dapp-kit';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Theme-matched wallet control — detected-wallet dropdown to connect, address + disconnect when connected. */
export function WalletButton() {
  const account = useCurrentAccount();
  const wallets = useWallets();
  const { mutate: connect } = useConnectWallet();
  const { mutate: disconnect } = useDisconnectWallet();
  const [open, setOpen] = useState(false);

  if (account) {
    return (
      <div style={{ position: 'relative' }}>
        <button className="pill accent" style={{ cursor: 'pointer', fontFamily: 'var(--mono)' }} onClick={() => setOpen((o) => !o)}>
          <span className="dot" style={{ background: 'var(--ink)' }} />{short(account.address)}
        </button>
        {open && (
          <div className="wallet-menu">
            <button className="wallet-opt" onClick={() => { navigator.clipboard?.writeText(account.address); setOpen(false); }}>Copy address</button>
            <button className="wallet-opt" onClick={() => { disconnect(); setOpen(false); }}>Disconnect</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-ink" style={{ boxShadow: 'var(--shadow-sm)', padding: '8px 14px' }} onClick={() => setOpen((o) => !o)}>
        Connect wallet
      </button>
      {open && (
        <div className="wallet-menu">
          {wallets.length === 0 && (
            <a className="wallet-opt" href="https://slush.app" target="_blank" rel="noreferrer">No wallet found — install Slush ↗</a>
          )}
          {wallets.map((w) => (
            <button key={w.name} className="wallet-opt" onClick={() => { connect({ wallet: w }); setOpen(false); }}>
              {w.icon && <img src={w.icon} alt="" width={16} height={16} style={{ borderRadius: 3 }} />}{w.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
