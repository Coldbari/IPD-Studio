// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useState, type CSSProperties } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../auth/firebase'
import Modal from '../panels/Modal'
import { useStore } from '../store/store'
import {
  deleteDrawing,
  formatBytes,
  listDrawings,
  loadFromCloud,
  renameDrawing,
  saveToCloud,
  type CloudDrawingMeta,
} from './sync'
import { tr, useT } from '../i18n'

const btn: CSSProperties = { padding: '3px 9px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', fontSize: 12, cursor: 'pointer' }
const btnPrimary: CSSProperties = { ...btn, borderColor: '#2b6cb0', color: '#2b6cb0' }
const btnDanger: CSSProperties = { ...btn, borderColor: '#c53030', color: '#9b1c1c' }

function relTime(ms: number): string {
  const secs = Math.max(0, Date.now() - ms) / 1000
  if (secs < 90) return tr('just now')
  if (secs < 3600) return Math.round(secs / 60) + ' ' + tr('min ago')
  if (secs < 86_400) return Math.round(secs / 3600) + ' ' + tr('h ago')
  if (secs < 7 * 86_400) return Math.round(secs / 86_400) + ' ' + tr('d ago')
  return new Date(ms).toLocaleDateString()
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : tr('Something went wrong. Try again.')
}

/** The signed-in user's drawings in Firestore: open, rename, delete, and save
 *  the drawing on screen — either over the one it came from or as a new one. */
export default function CloudDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useT()
  const dirty = useStore((s) => s.dirty)
  const cloudId = useStore((s) => s.cloudId)
  const setCloudId = useStore((s) => s.setCloudId)
  const loadIntoStore = useStore((s) => s.loadIntoStore)
  const markSaved = useStore((s) => s.markSaved)

  // undefined = Firebase has not said yet who is signed in
  const [uid, setUid] = useState<string | null | undefined>(undefined)
  const [rows, setRows] = useState<CloudDrawingMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ kind: 'open' | 'delete'; id: string } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!open) return
    return onAuthStateChanged(auth(), (user) => setUid(user ? user.uid : null))
  }, [open])

  useEffect(() => {
    if (!open || !uid) return
    let live = true
    setRows(null)
    setError(null)
    listDrawings(uid).then(
      (list) => { if (live) setRows(list) },
      (err: unknown) => { if (live) setError(message(err)) },
    )
    return () => { live = false }
  }, [open, uid, reload])

  // a fresh open should not inherit the last visit's half-finished prompts
  useEffect(() => {
    if (open) return
    setConfirming(null)
    setRenaming(null)
    setBusy(null)
  }, [open])

  if (!open) return null

  const list = rows ?? []
  const current = cloudId ? list.find((r) => r.id === cloudId) : undefined

  const save = async (asNew: boolean) => {
    if (!uid || busy) return
    const doc = useStore.getState().doc
    const target = asNew ? undefined : current
    setBusy(asNew ? t('Saving a copy…') : t('Saving…'))
    setError(null)
    try {
      const { id } = await saveToCloud(uid, doc, target ? { id: target.id, name: target.name } : { name: doc.meta.name })
      setCloudId(id)
      markSaved()
      setReload((n) => n + 1)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(null)
    }
  }

  const openDrawing = async (row: CloudDrawingMeta) => {
    if (!uid) return
    setConfirming(null)
    setBusy(t('Opening…'))
    setError(null)
    try {
      const { doc } = await loadFromCloud(uid, row.id)
      loadIntoStore(doc)
      setCloudId(row.id)
      onClose()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (row: CloudDrawingMeta) => {
    if (!uid) return
    setConfirming(null)
    setBusy(t('Deleting…'))
    setError(null)
    try {
      await deleteDrawing(uid, row.id)
      if (cloudId === row.id) setCloudId(null)
      setReload((n) => n + 1)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(null)
    }
  }

  const commitRename = async () => {
    if (!uid || !renaming) return
    const { id, value } = renaming
    setRenaming(null)
    setBusy(t('Renaming…'))
    setError(null)
    try {
      await renameDrawing(uid, id, value)
      // A drawing has one name. If this is the document currently open, carry
      // the rename into it too — otherwise the next "Save to cloud" from the
      // toolbar writes doc.meta.name straight back over the rename.
      if (cloudId === id) useStore.getState().setMeta({ name: value.trim() || tr('Untitled') })
      setReload((n) => n + 1)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(null)
    }
  }

  const idle = (style: CSSProperties): CSSProperties => (busy ? { ...style, opacity: 0.5, cursor: 'default' } : style)

  return (
    <Modal title={t('Cloud drawings')} onClose={onClose} width={520}>
      {uid === undefined && <div className="drawer-empty">{t('Checking your account…')}</div>}

      {uid === null && (
        <p className="prop-hint">
          {t('Sign in to keep drawings in your IPD Studio account. They stay private to that account — nobody else can list or open them.')}
        </p>
      )}

      {uid && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 10px' }}>
            <button style={idle(btnPrimary)} disabled={!!busy} onClick={() => void save(false)}>
              {current ? `${t('Save over')} “${current.name}”` : t('Save current drawing')}
            </button>
            <button style={idle(btn)} disabled={!!busy} onClick={() => void save(true)}>{t('Save as new')}</button>
            <span className="prop-hint" style={{ marginLeft: 'auto' }}>
              {busy ?? (dirty ? t('Unsaved changes') : '')}
            </span>
          </div>

          {error && (
            <div className="import-note" style={{ color: '#9b1c1c', background: '#fde8e8', borderColor: '#f0bcbc' }}>
              {error}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button style={btn} onClick={() => { setError(null); setReload((n) => n + 1) }}>{t('Reload list')}</button>
                <button style={btn} onClick={() => setError(null)}>{t('Dismiss')}</button>
              </div>
            </div>
          )}

          {rows === null && !error && <div className="drawer-empty">{t('Loading your drawings…')}</div>}

          {rows !== null && rows.length === 0 && (
            <div className="drawer-empty">
              {t('Nothing saved here yet. Save current drawing puts this drawing in your account, where it stays private to your sign-in and opens on any device you use it from.')}
            </div>
          )}

          {list.map((row) => {
            const ren = renaming?.id === row.id ? renaming : null
            const conf = confirming?.id === row.id ? confirming : null
            return (
              <div
                key={row.id}
                className="history-row"
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, cursor: 'default' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {ren ? (
                      <input
                        autoFocus
                        value={ren.value}
                        maxLength={200}
                        onChange={(e) => setRenaming({ id: row.id, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename()
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        style={{ width: '100%', font: 'inherit', padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4 }}
                      />
                    ) : (
                      <b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</b>
                    )}
                    <span>
                      {relTime(row.updatedAt)} · {formatBytes(row.sizeBytes)} · {row.sheetCount} {t(row.sheetCount === 1 ? 'sheet' : 'sheets')}
                      {row.id === cloudId ? ' · ' + t('open here') : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    {ren ? (
                      <>
                        <button style={idle(btnPrimary)} disabled={!!busy} onClick={() => void commitRename()}>{t('Save name')}</button>
                        <button style={btn} onClick={() => setRenaming(null)}>{t('Cancel')}</button>
                      </>
                    ) : (
                      <>
                        <button
                          style={idle(btnPrimary)}
                          disabled={!!busy}
                          onClick={() => (dirty ? setConfirming({ kind: 'open', id: row.id }) : void openDrawing(row))}
                        >
                          {t('Open')}
                        </button>
                        <button style={idle(btn)} disabled={!!busy} onClick={() => setRenaming({ id: row.id, value: row.name })}>{t('Rename')}</button>
                        <button style={idle(btn)} disabled={!!busy} onClick={() => setConfirming({ kind: 'delete', id: row.id })}>{t('Delete')}</button>
                      </>
                    )}
                  </div>
                </div>

                {conf && (
                  <div className="import-note" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                    <span style={{ flex: 1 }}>
                      {conf.kind === 'open'
                        ? t('Opening this replaces the drawing on screen — your unsaved changes are lost.')
                        : `${t('Delete drawing from your account? This cannot be undone.')} “${row.name}”`}
                    </span>
                    <button
                      style={idle(btnDanger)}
                      disabled={!!busy}
                      onClick={() => void (conf.kind === 'open' ? openDrawing(row) : remove(row))}
                    >
                      {conf.kind === 'open' ? t('Discard & open') : t('Delete')}
                    </button>
                    <button style={btn} onClick={() => setConfirming(null)}>{t('Cancel')}</button>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}
    </Modal>
  )
}
