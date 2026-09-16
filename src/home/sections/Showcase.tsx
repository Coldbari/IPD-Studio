// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { Workstation } from '../visuals/scenes'

/**
 * The third visual peak: one frame holding the drawing, its record, its solve
 * and its operator screen at once.
 *
 * The composition IS the argument. Four panels side by side showing the same
 * instrument makes "these are views of one model" a thing the reader sees
 * rather than a thing the page claims.
 *
 * Beneath it are two real screenshots of the running application. They are
 * deliberately placed after the reconstruction rather than before: the
 * reconstruction explains the idea at a glance, and the screenshots then
 * prove the software exists and looks like that.
 */
export default function Showcase() {
  return (
    <section id="showcase" className="band band-raised gridded">
      <div className="hwrap">
        <span className="eyebrow">The environment</span>
        <h2>Not four products. Four views of one engineering model.</h2>
        <p className="lede">
          Select <span className="mono">FT-101</span> anywhere and it is the same object everywhere:
          the symbol on the sheet, the row in the index, the value in the solve and the reading on the
          operator screen.
        </p>

        <div className="showcase-frame">
          <Workstation />
        </div>

        <div className="shots">
          <figure className="shot">
            <picture>
              <source srcSet="/media/editor.webp" type="image/webp" />
              <img
                src="/media/editor.png"
                alt="The IPD Studio editor: workspace rail, ISA symbol palette, a tagged P&ID on an A3 sheet, and the project inspector"
                loading="lazy"
                decoding="async"
                width={1680}
                height={1000}
              />
            </picture>
            <figcaption>The editor — six workspaces, ISA palette, drawing sheet, inspector</figcaption>
          </figure>
          <figure className="shot">
            <picture>
              <source srcSet="/media/hmi.webp" type="image/webp" />
              <img
                src="/media/hmi.png"
                alt="HMI Studio running the same plant: feed tank, pump, control valves and live process values on an operator mimic"
                loading="lazy"
                decoding="async"
                width={1680}
                height={560}
              />
            </picture>
            <figcaption>HMI Studio — the same plant, running</figcaption>
          </figure>
        </div>
      </div>
    </section>
  )
}
