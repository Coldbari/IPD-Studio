// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { VersionBanner } from '../panels/VersionNote'
import UpdateToast from '../panels/UpdateToast'
import Hero from './sections/Hero'
import Spine from './sections/Spine'
import Platform from './sections/Platform'
import Workflow from './sections/Workflow'
import Principles from './sections/Principles'
import Showcase from './sections/Showcase'
import Standards from './sections/Standards'
import Roadmap from './sections/Roadmap'
import Philosophy from './sections/Philosophy'
import Audience from './sections/Audience'
import Closing from './sections/Closing'
import Footer from './sections/Footer'
import './home.css'

/**
 * The front door.
 *
 * One story in eleven sections, in the order the work actually happens:
 *
 *     P&ID → engineering model → validation → simulation → HMI → automation
 *
 * The hero states it, the spine shows it happening to a single instrument, the
 * platform rows walk it again with detail, and the workflow names the six
 * workspaces that carry it. Everything after that is evidence: what the
 * environment looks like, which standards are involved, what is actually
 * shipped, what it costs and who it is for.
 *
 * Nothing here knows about the editor beyond two callbacks. The route split in
 * src/main.tsx means this page must never import the store, the symbol
 * registry or the simulator — a headline should not cost a visitor JointJS.
 */
export default function Home({
  onSignIn,
  onOpenEditor,
}: {
  onSignIn(): void
  onOpenEditor(): void
}) {
  return (
    <div className="home">
      <a className="skip" href="#main">Skip to content</a>

      <VersionBanner />

      <header className="bar">
        <div className="hwrap bar-in">
          <span className="wordmark">IPD Studio</span>
          <nav className="bar-nav" aria-label="Sections">
            <a href="#platform">Platform</a>
            <a href="#workflow">Workflow</a>
            <a href="#showcase">Showcase</a>
            <a href="#standards">Standards</a>
            <a href="#roadmap">Roadmap</a>
            <a href="#licence">Licence</a>
          </nav>
          <div className="bar-actions">
            <button type="button" className="linkbtn" onClick={onSignIn}>Sign in</button>
            <button type="button" className="btn btn-primary" onClick={onOpenEditor}>Open IPD Studio</button>
          </div>
        </div>
      </header>

      <main id="main">
        <Hero onOpenEditor={onOpenEditor} />
        <Spine />
        <Platform />
        <Workflow />
        <Showcase />
        <Principles />
        <Standards />
        <Roadmap />
        <Philosophy />
        <Audience />
        <Closing onOpenEditor={onOpenEditor} />
      </main>

      <Footer />
      <UpdateToast />
    </div>
  )
}
