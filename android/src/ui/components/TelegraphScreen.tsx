/** Telegraph tab — status, burner wallet, paid ask, receipts, miners. */
import { useEffect, useState } from 'react'
import { ArrowUpRight, Copy, Download, KeyRound, RefreshCw, Wallet } from 'lucide-react'
import type { TelegraphReceipt } from '@shared/types'
import { useTelegraphStore } from '../stores/telegraph'
import { useAppStore } from '../stores/app'
import { useT } from '../i18n'
import { Sheet, pushToast } from './ui'
import { bridge } from '../lib/bridge'

export function TelegraphScreen() {
  const t = useT()
  const status = useTelegraphStore((s) => s.status)
  const receipts = useTelegraphStore((s) => s.receipts)
  const miners = useTelegraphStore((s) => s.miners)
  const busy = useTelegraphStore((s) => s.busy)
  const lastAsk = useTelegraphStore((s) => s.lastAsk)
  const refreshAll = useTelegraphStore((s) => s.refreshAll)
  const createWallet = useTelegraphStore((s) => s.createWallet)
  const importWallet = useTelegraphStore((s) => s.importWallet)
  const ask = useTelegraphStore((s) => s.ask)
  const verify = useTelegraphStore((s) => s.verify)
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)

  const [askText, setAskText] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importKey, setImportKey] = useState('')
  const [exportKey, setExportKey] = useState<string | null>(null)
  const [verifyText, setVerifyText] = useState('')
  const [verifyResult, setVerifyResult] = useState<string | null>(null)

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const copy = async (text: string, msg: string) => {
    await navigator.clipboard.writeText(text)
    pushToast(msg)
  }

  const exportReceipts = () => {
    const blob = new Blob([JSON.stringify(receipts, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'halis-telegraph-receipts.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="topbar safe-top">
        <b className="grow">{t('tg_title')}</b>
        <button className="icon-btn" onClick={() => void refreshAll()} aria-label="refresh">
          <RefreshCw size={18} className={busy ? 'spin' : ''} />
        </button>
      </div>

      <div className="screen">
        {settings && !settings.telegraphEnabled ? (
          <div className="card" style={{ padding: 12, marginBottom: 12, borderColor: 'var(--hal-amber)' }}>
            <div className="hint">{t('tg_disabled_banner')}</div>
          </div>
        ) : null}

        {/* status card */}
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <Wallet size={18} style={{ color: 'var(--hal-accent)' }} />
            <b style={{ fontSize: 15 }}>{t('tg_wallet')}</b>
            <span className={`chip ${status?.nodeReachable ? 'chip-green' : 'chip-amber'}`} style={{ marginLeft: 'auto' }}>
              {status ? (status.nodeReachable ? t('connected') : t('tg_offline')) : '…'}
            </span>
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            {status?.networkLabel} · {t('tg_testnet_banner')}
          </div>

          {status?.walletAddress ? (
            <>
              <div className="row" style={{ marginTop: 10 }}>
                <div className="grow hint" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {status.walletAddress}
                </div>
                <button className="icon-btn" onClick={() => void copy(status.walletAddress!, t('wallet_copied'))} aria-label="copy">
                  <Copy size={15} />
                </button>
              </div>
              <div className="row" style={{ marginTop: 6, gap: 10 }}>
                <div>
                  <div className="hint">{t('tg_balance')}</div>
                  <b style={{ fontSize: 17 }}>{Number(status.usdcBalance).toFixed(2)} USDC</b>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div className="hint">{t('tg_spent_today')}</div>
                  <b>${status.spentTodayUsd.toFixed(2)}</b>
                </div>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>{t('tg_fund_hint')}</div>
              <button
                className="btn btn-sm"
                style={{ marginTop: 8 }}
                onClick={() =>
                  void bridge.tgExportWallet().then((res) => {
                    setExportKey(res?.privateKey ?? null)
                  })
                }
              >
                <KeyRound size={14} /> {t('tg_export_wallet')}
              </button>
            </>
          ) : (
            <>
              <div className="hint" style={{ margin: '10px 0' }}>{t('tg_no_wallet')}</div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-primary btn-sm grow" disabled={busy} onClick={() => void createWallet()}>
                  {t('tg_create_wallet')}
                </button>
                <button className="btn btn-sm grow" onClick={() => setImportOpen(true)}>
                  {t('tg_import_wallet')}
                </button>
              </div>
            </>
          )}
        </div>

        {/* stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
          {[
            { label: t('tg_miners'), value: status ? String(status.minerCount) : '…' },
            { label: t('tg_intents'), value: status ? String(status.intentCount) : '…' },
            { label: t('tg_receipts'), value: status ? String(status.receiptsTotal) : '…' },
          ].map((s) => (
            <div key={s.label} className="card" style={{ padding: 10, textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{s.value}</div>
              <div className="hint">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ask */}
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <b style={{ fontSize: 14 }}>{t('tg_ask_title')}</b>
          <div className="hint" style={{ margin: '2px 0 8px' }}>
            {t('tg_ask_cost')} · {t('tg_budget')}: ${settings?.telegraph.dailyBudgetUsd ?? 0}
          </div>
          <textarea
            className="field"
            rows={2}
            value={askText}
            placeholder={t('tg_ask_placeholder')}
            onChange={(e) => setAskText(e.target.value)}
          />
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={busy || !askText.trim()} onClick={() => void ask(askText.trim()).then(() => setAskText(''))}>
            {busy ? <span className="spinner" /> : null}
            {t('tg_ask_run')}
          </button>
          {lastAsk ? (
            <div style={{ marginTop: 10, fontSize: 13.5 }}>
              {lastAsk.error ? (
                <span className="chip chip-red">{lastAsk.error}</span>
              ) : (
                <>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <span className="chip chip-accent">{lastAsk.minerName}</span>
                    {lastAsk.intent ? <span className="chip">{lastAsk.intent}</span> : null}
                    <span className="chip chip-green">${lastAsk.costUsd.toFixed(2)}</span>
                    <span className="hint">{lastAsk.durationMs}ms</span>
                  </div>
                  <div style={{ marginTop: 6, maxHeight: 220, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--hal-ink-soft)' }}>
                    {typeof lastAsk.result === 'string' ? lastAsk.result : JSON.stringify(lastAsk.result, null, 2)?.slice(0, 4000)}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* verify */}
        <div className="card" style={{ padding: 14, marginBottom: 12 }}>
          <b style={{ fontSize: 14 }}>{t('tg_verify')}</b>
          <div className="row" style={{ marginTop: 8, gap: 8 }}>
            <input className="field grow" style={{ fontFamily: 'monospace', fontSize: 12.5 }} placeholder="signal hash…" value={verifyText} onChange={(e) => setVerifyText(e.target.value)} />
            <button
              className="btn btn-sm"
              disabled={!verifyText.trim()}
              onClick={() =>
                void verify(verifyText.trim()).then((r) => setVerifyResult(r.found ? `${t('tg_verified')}\n${r.detail.slice(0, 600)}` : `${t('tg_not_found')}: ${r.detail.slice(0, 200)}`))
              }
            >
              {t('tg_verify')}
            </button>
          </div>
          {verifyResult ? <div className="hint" style={{ marginTop: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{verifyResult}</div> : null}
        </div>

        {/* receipts */}
        <div className="row" style={{ marginBottom: 8 }}>
          <b style={{ fontSize: 14 }}>{t('tg_receipts')}</b>
          <div className="grow" />
          <button className="btn btn-sm" onClick={exportReceipts} disabled={!receipts.length}>
            <Download size={13} /> {t('tg_export_receipts')}
          </button>
        </div>
        {receipts.map((r) => (
          <ReceiptRow key={r.receiptHash} receipt={r} onCopy={copy} />
        ))}
        {!receipts.length ? <div className="hint" style={{ textAlign: 'center', padding: 18 }}>{t('tg_receipts_empty')}</div> : null}

        {/* miners */}
        {miners.length ? (
          <details style={{ marginTop: 14 }}>
            <summary style={{ fontWeight: 650, fontSize: 14, cursor: 'pointer' }}>
              {t('tg_miners_list')} ({miners.length})
            </summary>
            <div style={{ marginTop: 8 }}>
              {miners.slice(0, 40).map((m) => (
                <div key={m.id} className="row" style={{ padding: '7px 0', borderBottom: '1px solid var(--hal-border)', fontSize: 13 }}>
                  <span className="grow" style={{ fontWeight: 600 }}>{m.name}</span>
                  {m.minPriceUsdc !== undefined ? <span className="chip">${m.minPriceUsdc.toFixed(3)}</span> : null}
                  <span className="hint" style={{ maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.supportedIntents.slice(0, 3).join(', ')}
                  </span>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      <Sheet open={importOpen} onClose={() => setImportOpen(false)} title={t('tg_import_wallet')}>
        <input className="field" style={{ fontFamily: 'monospace', fontSize: 13 }} placeholder="0x…" value={importKey} onChange={(e) => setImportKey(e.target.value)} />
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 10 }}
          onClick={() =>
            void importWallet(importKey.trim()).then((res) => {
              if (res.ok) {
                setImportOpen(false)
                setImportKey('')
              } else pushToast(res.error ?? 'Import failed', 'error')
            })
          }
        >
          {t('confirm')}
        </button>
        <div className="hint" style={{ marginTop: 8 }}>{t('tg_no_wallet')}</div>
      </Sheet>

      <Sheet open={!!exportKey} onClose={() => setExportKey(null)} title={t('tg_export_wallet')}>
        <div style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all', padding: 10, background: 'var(--hal-bg-soft)', borderRadius: 10 }}>{exportKey}</div>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 10 }}
          onClick={() => {
            if (exportKey) void copy(exportKey, t('key_copied'))
            setExportKey(null)
          }}
        >
          <Copy size={15} /> {t('copy')}
        </button>
      </Sheet>
    </>
  )
}

function ReceiptRow({ receipt: r, onCopy }: { receipt: TelegraphReceipt; onCopy: (text: string, msg: string) => Promise<void> }) {
  const t = useT()
  return (
    <div className="card" style={{ padding: 11, marginBottom: 8 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="chip chip-accent">{r.miner || '?'}</span>
        {r.intent ? <span className="chip">{r.intent}</span> : null}
        <span className="chip chip-green">${r.amountUsd.toFixed(2)}</span>
        <span className="hint" style={{ marginLeft: 'auto' }}>
          {new Date(r.timestamp > 1e12 ? r.timestamp : r.timestamp * 1000).toLocaleString()}
        </span>
      </div>
      {r.query ? <div className="hint" style={{ marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{r.query}”</div> : null}
      {r.txHash ? (
        <div className="row" style={{ marginTop: 6, gap: 6 }}>
          <span className="hint" style={{ fontFamily: 'monospace', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.txHash.slice(0, 22)}…
          </span>
          <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => void onCopy(r.txHash, t('copied'))} aria-label="copy tx">
            <Copy size={13} />
          </button>
          {r.explorerUrl ? (
            <a className="chip chip-blue" href={r.explorerUrl} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>
              <ArrowUpRight size={11} /> {t('tg_view_tx')}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
