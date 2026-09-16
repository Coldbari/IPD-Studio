// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { EditorWindow } from '../visuals/scenes'

/**
 * The hero states the category, the claim and the proof in that order.
 *
 * The four verbs are set as a list against a hairline rather than as a
 * paragraph, because they are the product's four stages and the page spends
 * the next six sections walking through them in that exact order. Setting them
 * as prose would waste the one place the structure is free.
 */
export default function Hero({ onOpenEditor }: { onOpenEditor(): void }) {
  return (
    <section className="band hero gridded">
      <div className="hwrap hero-in">
        <div>
          <p className="hero-mark"><b>IPD Studio</b> — Professional engineering platform</p>

          <h1>Professional P&amp;ID engineering, built for the next generation of industrial automation.</h1>

          <ul className="hero-verbs">
            <li><b>Design</b> the process.</li>
            <li><b>Model</b> the engineering.</li>
            <li><b>Simulate</b> the system.</li>
            <li><b>Connect</b> it to automation.</li>
          </ul>

          <p className="lede">
            IPD Studio brings P&amp;ID design, engineering data, process simulation, HMI development,
            validation and industrial interoperability into one engineering workflow.
          </p>

          <div className="hero-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={onOpenEditor}>
              Open IPD Studio
            </button>
            <a className="btn btn-ghost btn-lg" href="#platform">Explore the platform</a>
          </div>

          <ul className="hero-meta">
            <li>Browser-based</li>
            <li>Engineering-first</li>
            <li>Open standards</li>
            <li>For process &amp; instrumentation engineers</li>
          </ul>
        </div>

        <EditorWindow />
      </div>
    </section>
  )
}
