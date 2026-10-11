/** Telegraph view: wallet, network, spend dashboard, receipts, intents, ask tester. */
import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Copy, Download, ExternalLink, Import, KeyRound, Plus, RefreshCw, Search, ShieldCheck, Zap, ZapOff } from 'lucide-react'
import { useT } from '../../i18n'
import { useAppStore } from '../../stores/app'
import { useTelegraphStore } from '../../stores/telegraph'
import { Badge, Button, Input, Modal, SectionTitle, Spinner, Textarea } from '../ui'

export function TelegraphView() {
  const t = useT()
  const tg = useTelegraphStore()
  const { settings, setSettings } = useAppStore()
  const [importOpen, setImportOpen] = useState(false)
  const [importKey, setImportKey] = useState('')
  const [importError, setImportError] = useState('')
  const [askQuery, setAskQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const [txsCopied, setTxsCopied] = useState(false)

  useEffect(() => {
    void tg.refreshAll()
    const onReceipt = () => void tg.loadReceipts()
    window.addEventListener('halis:receipt', onReceipt)
    return () => window.removeEventListener('halis:receipt', onReceipt)
  }, [])

  const status = tg.status
  const network = settings?.telegraph.networkId === 'base-mainnet' ? 'Base' : 'Base Sepolia'
  const disabled = settings ? settings.telegraphEnabled === false : false

  const exportReceipts = () => {
    const blob = new Blob([JSON.stringify(tg.receipts, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `halis-telegraph-receipts-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyTxHashes = () => {
    const hashes = [...new Set(tg.receipts.filter((r) => r.txHash).map((r) => r.txHash!))]
    void navigator.clipboard.writeText(hashes.join('\n'))
    setTxsCopied(true)
    setTimeout(() => setTxsCopied(false), 1400)
  }

  const settledTxs = new Set(tg.receipts.filter((r) => r.txHash).map((r) => r.txHash)).size

  const doImport = async () => {
    setImportError('')
    const err = await tg.importWallet(importKey.trim())
    if (err && err.length > 42) {
      setImportError(err)
      return
    }
    setImportOpen(false)
    setImportKey('')
    await tg.refreshAll()
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-7">
        <div>
          <SectionTitle hint={status ? `${status.minerCount} miners · ${status.intentCount} intents` : undefined}>{t('tg_title')}</SectionTitle>
          <p className="text-[13px] text-muted -mt-2">{t('tg_subtitle')}</p>
        </div>

        {/* master switch off — the whole protocol surface is paused */}
        {disabled ? (
          <div className="rounded-xl border border-amber/30 bg-amber/5 px-4 py-3 text-[12px] text-amber/90 flex items-start gap-2.5">
            <ZapOff size={15} className="shrink-0 mt-0.5" />
            <div>
              <div>{t('tg_disabled_banner')}</div>
              <div className="mt-1 text-[11.5px] text-faint">{t('tg_disabled_cta')}</div>
            </div>
          </div>
        ) : null}

        {/* testnet boundary banner — always visible, unprompted */}
        {!disabled && status?.isTestnet ? (
          <div className="rounded-xl border border-cyan/25 bg-cyan/5 px-4 py-3 text-[12px] text-cyan/90 flex items-start gap-2.5">
            <ShieldCheck size={15} className="shrink-0 mt-0.5" />
            <span>{t('tg_testnet_banner')}</span>
          </div>
        ) : null}

        {/* wallet + network cards */}
        {disabled ? null : (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-line bg-panel2 p-4">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound size={14} className="text-signal" />
              <span className="text-[13.5px] font-semibold">{t('tg_wallet')}</span>
              {status?.walletFunded ? <Badge color="#4ADE80">funded</Badge> : status?.walletAddress ? <Badge color="#FBBF24">no funds</Badge> : null}
            </div>
            {status?.walletAddress ? (
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] text-faint mb-1">{t('tg_address')}</div>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-[11.5px] text-muted truncate flex-1 bg-[#0d1119] rounded-lg px-2.5 py-1.5 border border-line selectable">
                      {status.walletAddress}
                    </code>
                    <button
                      className="text-faint hover:text-ink cursor-pointer"
                      onClick={() => {
                        void navigator.clipboard.writeText(status.walletAddress!)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1400)
                      }}
                    >
                      {copied ? <Check size={13} className="text-good" /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] text-faint">{t('tg_balance')}</span>
                  <span className="font-mono text-[15px] text-good">{status.usdcBalance} USDC</span>
                </div>
                <p className="text-[11px] text-faint leading-relaxed">{t('tg_fund_hint')}</p>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
                    <Import size={12} /> {t('tg_import_wallet')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const r = window.halis.tgExportWallet()
                      void r.then((res) => {
                        if (res?.privateKey) void navigator.clipboard.writeText(res.privateKey)
                      })
                    }}
                  >
                    {t('tg_export')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[12.5px] text-muted leading-relaxed">{t('tg_no_wallet')}</p>
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" onClick={() => void tg.createWallet()} disabled={tg.busy}>
                    {tg.busy ? <Spinner size={12} /> : <Plus size={13} />} {t('tg_create_wallet')}
                  </Button>
                  <Button size="sm" onClick={() => setImportOpen(true)}>
                    <Import size={12} /> {t('tg_import_wallet')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-panel2 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} className="text-cyan" />
              <span className="text-[13.5px] font-semibold">{t('tg_network')}</span>
              <Badge color={status?.nodeReachable === false ? '#F87171' : '#4ADE80'}>{status?.nodeReachable === false ? t('tg_offline') : network}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px]">
              <dt className="text-faint">{t('tg_miners')}</dt>
              <dd className="font-mono text-right">{status?.minerCount ?? '—'}</dd>
              <dt className="text-faint">{t('tg_intents')}</dt>
              <dd className="font-mono text-right">{status?.intentCount ?? '—'}</dd>
              <dt className="text-faint">{t('tg_spent_today')}</dt>
              <dd className="font-mono text-right text-amber">${(status?.spentTodayUsd ?? 0).toFixed(2)}</dd>
              <dt className="text-faint">{t('tg_spent_total')}</dt>
              <dd className="font-mono text-right">${(status?.spentTotalUsd ?? 0).toFixed(2)}</dd>
              <dt className="text-faint">{t('tg_receipts')}</dt>
              <dd className="font-mono text-right">{status?.receiptsTotal ?? 0}</dd>
            </dl>
            <div className="mt-4 pt-3 border-t border-line/70 space-y-3">
              <label className="block">
                <span className="text-[11px] text-faint">{t('tg_budget')}</span>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={settings?.telegraph.dailyBudgetUsd ?? 5}
                  onChange={(e) => void setSettings({ telegraph: { ...(settings?.telegraph ?? { networkId: 'base-sepolia', autoApproveUpTo: 0, dailyBudgetUsd: 5 }), dailyBudgetUsd: Number(e.target.value) || 0 } })}
                  className="!py-1.5 !text-xs mt-1"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-faint">{t('tg_autoapprove')}</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={settings?.telegraph.autoApproveUpTo ?? 0}
                  onChange={(e) => void setSettings({ telegraph: { ...(settings?.telegraph ?? { networkId: 'base-sepolia', autoApproveUpTo: 0, dailyBudgetUsd: 5 }), autoApproveUpTo: Number(e.target.value) || 0 } })}
                  className="!py-1.5 !text-xs mt-1"
                />
              </label>
            </div>
          </div>
        </div>
        )}

        {/* ask tester */}
        {disabled ? null : (
        <div className="rounded-2xl border border-line bg-panel2 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Search size={14} className="text-signal" />
            <span className="text-[13.5px] font-semibold">{t('tg_ask_title')}</span>
            <span className="text-[11px] text-faint">{t('tg_ask_cost')}</span>
          </div>
          <div className="flex gap-2 mt-2">
            <Input value={askQuery} onChange={(e) => setAskQuery(e.target.value)} placeholder={t('tg_ask_placeholder')} onKeyDown={(e) => { if (e.key === 'Enter' && askQuery.trim()) { void tg.ask(askQuery.trim()); } }} />
            <Button variant="primary" onClick={() => askQuery.trim() && void tg.ask(askQuery.trim())} disabled={!askQuery.trim() || tg.busy}>
              {tg.busy ? <Spinner size={13} /> : <Zap size={13} />} {t('tg_ask_run')}
            </Button>
          </div>
          {tg.lastAsk ? (
            <div className="mt-3 rounded-xl border border-line bg-[#0d1119] p-3.5 rise">
              {tg.lastAsk.error ? (
                <div className="text-[12.5px] text-red">{tg.lastAsk.error}</div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Badge color="#22D3EE">miner {tg.lastAsk.minerName}</Badge>
                    {tg.lastAsk.intent ? <Badge>{tg.lastAsk.intent}</Badge> : null}
                    <Badge color="#4ADE80">${tg.lastAsk.costUsd.toFixed(2)}</Badge>
                    {tg.lastAsk.receipt?.txHash ? (
                      <a
                        className="inline-flex items-center gap-1 text-[11px] text-cyan hover:underline cursor-pointer"
                        onClick={(e) => {
                          e.preventDefault()
                          window.open(tg.lastAsk!.receipt!.explorerUrl ?? '#', '_blank', 'noopener')
                        }}
                      >
                        tx {tg.lastAsk.receipt.txHash.slice(0, 10)}… <ExternalLink size={10} />
                      </a>
                    ) : null}
                  </div>
                  <pre className="text-[11.5px] text-muted whitespace-pre-wrap break-words max-h-64 overflow-y-auto selectable font-mono">
                    {typeof tg.lastAsk.result === 'string' ? tg.lastAsk.result : JSON.stringify(tg.lastAsk.result, null, 2).slice(0, 3000)}
                  </pre>
                </>
              )}
            </div>
          ) : null}
        </div>
        )}

        {/* receipts */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[13.5px] font-semibold">
              {t('tg_receipts')}
              {settledTxs > 0 ? <span className="ml-2 text-[11px] text-faint font-normal">{settledTxs} {t('tg_tx_count')}</span> : null}
            </h3>
            <div className="flex items-center gap-1.5">
              {settledTxs > 0 ? (
                <Button size="sm" variant="ghost" onClick={copyTxHashes} title={t('tg_copy_txs')}>
                  {txsCopied ? <Check size={12} className="text-good" /> : <Copy size={12} />}
                  <span className="ml-1.5 hidden sm:inline">{t('tg_copy_txs')}</span>
                </Button>
              ) : null}
              {tg.receipts.length > 0 ? (
                <Button size="sm" variant="ghost" onClick={exportReceipts} title={t('tg_export_receipts')}>
                  <Download size={12} />
                  <span className="ml-1.5 hidden sm:inline">{t('tg_export_receipts')}</span>
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => void tg.refreshAll()}>
                <RefreshCw size={12} />
              </Button>
            </div>
          </div>
          {tg.receipts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-[12.5px] text-faint">{t('tg_receipts_empty')}</div>
          ) : (
            <div className="rounded-2xl border border-line overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-panel3/60 text-faint text-left">
                    <th className="px-3.5 py-2 font-medium">{t('tg_when')}</th>
                    <th className="px-3.5 py-2 font-medium">{t('tg_intent')}</th>
                    <th className="px-3.5 py-2 font-medium">{t('tg_miner')}</th>
                    <th className="px-3.5 py-2 font-medium text-right">{t('tg_amount')}</th>
                    <th className="px-3.5 py-2 font-medium">{t('tg_tx')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {tg.receipts.slice(0, 50).map((r) => (
                    <tr key={r.receiptHash} className="hover:bg-panel2/50">
                      <td className="px-3.5 py-2 text-muted font-mono">{new Date(r.timestamp * 1000).toLocaleTimeString()}</td>
                      <td className="px-3.5 py-2">
                        <Badge color="#7C6CFF">{r.intent || '—'}</Badge>
                      </td>
                      <td className="px-3.5 py-2 font-mono text-muted">{r.miner || '—'}</td>
                      <td className="px-3.5 py-2 text-right font-mono text-amber">${r.amountUsd.toFixed(2)}</td>
                      <td className="px-3.5 py-2">
                        {r.txHash ? (
                          <a
                            className="inline-flex items-center gap-1 text-cyan hover:underline cursor-pointer font-mono text-[11px]"
                            onClick={(e) => {
                              e.preventDefault()
                              window.open(r.explorerUrl ?? '#', '_blank', 'noopener')
                            }}
                          >
                            {r.txHash.slice(0, 10)}… <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* intents */}
        {!disabled && tg.intents.length ? (
          <div>
            <h3 className="text-[13.5px] font-semibold mb-2">{t('tg_intents_list')}</h3>
            <div className="flex flex-wrap gap-1.5">
              {tg.intents.slice(0, 80).map((i) => (
                <Badge key={i.id} className="!text-[10px]">
                  {i.id}
                </Badge>
              ))}
              {tg.intents.length > 80 ? <span className="text-[11px] text-faint">+{tg.intents.length - 80}</span> : null}
            </div>
          </div>
        ) : null}

        {/* import modal */}
        {!disabled && (
        <Modal open={importOpen} onClose={() => setImportOpen(false)} title={<span className="flex items-center gap-2"><Import size={14} /> {t('tg_import_wallet')}</span>}>
          <p className="text-[12.5px] text-muted mb-3">{t('tg_no_wallet')}</p>
          <Textarea
            value={importKey}
            onChange={(e) => setImportKey(e.target.value)}
            placeholder="0x…"
            rows={3}
            className="font-mono !text-xs"
          />
          {importError ? (
            <div className="mt-2 flex items-start gap-1.5 text-[12px] text-red">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {importError}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              {t('cancel')}
            </Button>
            <Button variant="primary" onClick={() => void doImport()} disabled={!importKey.trim()}>
              {t('confirm')}
            </Button>
          </div>
        </Modal>
        )}

      </div>
    </div>
  )
}
