// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import Modal from '../../src/panels/Modal'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

async function mount(el: React.ReactElement): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(el))
  return host
}

/** Closing is driven by mousedown, not click, so the tests have to press. */
function press(el: HTMLElement): void {
  el.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
}

beforeEach(() => { document.body.innerHTML = '' })

describe('Modal', () => {
  it('renders title and children in the shared card', async () => {
    const host = await mount(<Modal title="Delete screen" onClose={() => {}}><p>body text</p></Modal>)
    expect(host.querySelector('.search-overlay')).toBeTruthy()
    expect(host.querySelector('.datasheet-box')).toBeTruthy()
    expect(host.innerHTML).toContain('Delete screen')
    expect(host.innerHTML).toContain('body text')
  })

  it('Escape and a backdrop press close; pressing the card does not', async () => {
    const onClose = vi.fn()
    const host = await mount(<Modal title="T" onClose={onClose}>x</Modal>)
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => press(host.querySelector('.datasheet-box') as HTMLElement))
    expect(onClose).toHaveBeenCalledTimes(1)
    await act(async () => press(host.querySelector('.search-overlay') as HTMLElement))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  // The reason closing moved from click to mousedown: select text in a
  // textarea, drag past the card edge and release, and the click lands on the
  // overlay. Every dialog before the feedback form got away with it because
  // none of them held typing worth losing.
  it('survives a drag that starts inside the card and ends on the backdrop', async () => {
    const onClose = vi.fn()
    const host = await mount(<Modal title="T" onClose={onClose}>x</Modal>)
    const card = host.querySelector('.datasheet-box') as HTMLElement
    const overlay = host.querySelector('.search-overlay') as HTMLElement
    await act(async () => {
      card.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
      overlay.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }))
      overlay.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('is inert while busy, so a send in flight cannot be dismissed', async () => {
    const onClose = vi.fn()
    const host = await mount(<Modal title="T" onClose={onClose} busy>x</Modal>)
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
      press(host.querySelector('.search-overlay') as HTMLElement)
    })
    expect(onClose).not.toHaveBeenCalled()
    expect((host.querySelector('.datasheet-head button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('moves focus into the card on open and hands it back on close', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(<Modal title="T" onClose={() => {}}>x</Modal>))
    expect(document.activeElement).toBe(host.querySelector('.datasheet-box'))
    await act(async () => root.unmount())
    expect(document.activeElement).toBe(opener)
  })
})
