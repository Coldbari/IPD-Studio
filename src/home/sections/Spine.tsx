// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright © 2026 Praharsh Nagpure — IPD Studio. Noncommercial use only;
// commercial use requires a paid license (see COMMERCIAL-LICENSE.md).

import { useEffect, useRef, useState } from 'react'
import { STAGES } from '../content'
import { STAGE_FIGURES } from '../visuals/stages'

/** How long each stage holds the highlight. Slow enough to read a panel
 *  before the next one lights, which is the point of the device. */
const DWELL_MS = 2200

/**
 * THE SIGNATURE SECTION.
 *
 * One highlight walks the six stages. It is the page's only unprompted
 * motion, and it earns that because it is doing the explaining: the reader's
 * eye is pulled along the same path the engineering data takes, which is
 * faster than the sentence that would otherwise have to say so.
 *
 * Three conditions switch it off, and all three are respected before the
 * interval is ever created: reduced motion, an off-screen section, and a
 * browser without IntersectionObserver. In every one of those cases the spine
 * renders complete and static — the content never depends on the animation.
 */
export default function Spine() {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    if (typeof IntersectionObserver === 'undefined') return

    let timer: ReturnType<typeof setInterval> | undefined
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = undefined
      setActive(null)
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          if (timer) return
          setActive(0)
          timer = setInterval(() => setActive((i) => ((i ?? 0) + 1) % STAGES.length), DWELL_MS)
        } else {
          // Off screen it must not keep ticking: a timer nobody can see is
          // just a wakeup on someone's battery.
          stop()
        }
      },
      { threshold: 0.25 },
    )
    io.observe(node)
    return () => {
      io.disconnect()
      stop()
    }
  }, [])

  return (
    <section id="model" className="band band-raised">
      <div className="hwrap">
        <div className="spine-head">
          <span className="eyebrow">From P&amp;ID to process intelligence</span>
          <h2>One engineering identity. Multiple engineering views.</h2>
          <p className="lede">
            A P&amp;ID should not be just a drawing. It should be the engineering source of truth for
            the process. IPD Studio is built on a topology-first model: the tag is the durable
            identity, and the diagram, the engineering record, the checks, the solve and the operator
            screen are all views of it rather than separate copies of it.
          </p>
          <p className="lede">
            Below is one instrument — <span className="mono">FT-101</span> — as it appears at each
            stage. It is the same object every time.
          </p>
        </div>

        <div className={`spine${active === null ? '' : ' live'}`} ref={ref}>
          {STAGES.map((stage, i) => {
            const Figure = STAGE_FIGURES[stage.id]!
            return (
              <div key={stage.id} className={`stage${i === active ? ' active' : ''}`}>
                <span className="stage-no">{stage.step}</span>
                <span className="stage-title">{stage.title}</span>
                <span className="stage-kicker">{stage.kicker}</span>
                {/* stage 01 is ink on paper, so its panel is the sheet itself */}
                <div className={`stage-fig${stage.id === 'pid' ? ' paper' : ''}`}>
                  <Figure />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
