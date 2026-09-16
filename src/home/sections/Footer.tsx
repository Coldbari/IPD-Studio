// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { LINKS } from '../content'

/**
 * A drawing sheet ends in a title block, and so does this page — the same
 * device the previous homepage used, kept because it is the one piece of that
 * design that was genuinely specific to this product.
 *
 * Attribution is honest: IPD Studio is one person's project, not a company, so
 * the block names the author rather than inventing a corporate entity.
 */
export default function Footer() {
  return (
    <footer className="foot">
      <div className="hwrap">
        <div className="foot-top">
          <div className="foot-brand">
            <span className="wordmark">IPD Studio</span>
            <p>
              Professional engineering software for P&amp;ID design, process modelling, simulation and
              industrial automation.
            </p>
          </div>

          <nav className="foot-col" aria-label="Product">
            <h4>Product</h4>
            <ul>
              <li><a href="#platform">Platform</a></li>
              <li><a href="#pid">P&amp;ID engineering</a></li>
              <li><a href="#data">Engineering data</a></li>
              <li><a href="#showcase">Showcase</a></li>
            </ul>
          </nav>

          <nav className="foot-col" aria-label="Engineering">
            <h4>Engineering</h4>
            <ul>
              <li><a href="#sim">Simulation</a></li>
              <li><a href="#hmi">HMI</a></li>
              <li><a href="#checks">Validation</a></li>
              <li><a href="#standards">Standards</a></li>
            </ul>
          </nav>

          <nav className="foot-col" aria-label="Project">
            <h4>Project</h4>
            <ul>
              <li><a href="#roadmap">Roadmap</a></li>
              <li><a href={LINKS.docs} target="_blank" rel="noreferrer">Documentation</a></li>
              <li><a href={LINKS.repo} target="_blank" rel="noreferrer">GitHub</a></li>
              <li><a href={`mailto:${LINKS.email}`}>Contact</a></li>
            </ul>
          </nav>
        </div>

        <dl className="block">
          <div><dt>Drawing</dt><dd>IPD Studio — engineering platform</dd></div>
          <div><dt>Rev</dt><dd>{__APP_VERSION__}</dd></div>
          <div>
            <dt>Licence</dt>
            <dd><a href={LINKS.licence} target="_blank" rel="noreferrer">PolyForm Noncommercial 1.0.0</a></dd>
          </div>
          <div><dt>Drawn by</dt><dd>Praharsh Nagpure</dd></div>
          <div>
            <dt>Source</dt>
            <dd><a href={LINKS.repo} target="_blank" rel="noreferrer">github.com/Coldbari/IPD-Studio</a></dd>
          </div>
          <div><dt>Contact</dt><dd><a href={`mailto:${LINKS.email}`}>{LINKS.email}</a></dd></div>
        </dl>

        <p className="foot-legal">© 2026 IPD Studio · Praharsh Nagpure. All rights reserved.</p>
      </div>
    </footer>
  )
}
