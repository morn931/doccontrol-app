'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * One-day celebration overlay — Liezl, 11 Sep 2026: "when doc control is opened by
 * any of the RDMC engineering team, only for the 11 of September 2026, have an
 * animated large celebratory 'Congrats on the tender submission!' in red run over
 * the screen, with fireworks popping in all colours." Every CoreDocs user counts.
 *
 * Shows ONCE per person (localStorage, keyed by email + day), on their first page
 * load on SHOW_ON (Central Africa Time), and goes away on Close or once the banner has crossed three times (42 s).
 * `?celebrate=1` previews it without spending the person's one showing.
 * After SHOW_ON this file is inert; delete it whenever.
 */
const SHOW_ON = '2026-09-11'
const BANNER_PASS_S = 14
const BANNER_PASSES = 3
const AUTO_CLOSE_MS = BANNER_PASS_S * BANNER_PASSES * 1000   // three full crossings, then gone

const COLORS = ['#ff3b3b', '#ffb703', '#ffe600', '#2ecc71', '#00c2ff', '#3d5afe', '#c77dff', '#ff5fa2', '#ffffff']

function todayInCAT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export default function TenderCelebration({ email }: { email: string }) {
  const [show, setShow] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const preview = new URLSearchParams(window.location.search).get('celebrate') === '1'
    if (!preview && todayInCAT() !== SHOW_ON) return
    const key = `tender-celebration:${SHOW_ON}:${email.toLowerCase()}`
    if (!preview) {
      try { if (localStorage.getItem(key)) return; localStorage.setItem(key, new Date().toISOString()) } catch { /* private mode: show anyway */ }
    }
    setShow(true)
    const t = setTimeout(() => setShow(false), AUTO_CLOSE_MS)
    return () => clearTimeout(t)
  }, [email])

  useEffect(() => {
    if (!show) return
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const resize = () => { c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0) }
    resize(); addEventListener('resize', resize)
    type Rocket = { x: number; y: number; vx: number; vy: number; color: string; trail: { x: number; y: number }[] }
    type Spark = { x: number; y: number; vx: number; vy: number; life: number; age: number; color: string; size: number }
    const rockets: Rocket[] = [], sparks: Spark[] = []
    const rand = (a: number, b: number) => a + Math.random() * (b - a)
    const pick = () => COLORS[Math.floor(Math.random() * COLORS.length)]
    const launch = () => rockets.push({ x: rand(innerWidth * 0.1, innerWidth * 0.9), y: innerHeight + 10, vx: rand(-1.2, 1.2), vy: rand(-14, -10), color: pick(), trail: [] })
    const burst = (x: number, y: number, color: string) => {
      const n = 90 + Math.floor(Math.random() * 60), multi = Math.random() < 0.35
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2) * i / n + rand(-0.05, 0.05), s = rand(2.5, 7.5)
        sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(55, 95), age: 0, color: multi ? pick() : color, size: rand(1.6, 3.2) })
      }
    }
    let t = 0, raf = 0, alive = true
    const frame = () => {
      if (!alive) return
      ctx.clearRect(0, 0, innerWidth, innerHeight)
      if (t % 18 === 0) launch()
      if (t % 45 === 0 && Math.random() < 0.7) launch()
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]; r.x += r.vx; r.y += r.vy; r.vy += 0.16
        r.trail.push({ x: r.x, y: r.y }); if (r.trail.length > 10) r.trail.shift()
        ctx.strokeStyle = r.color; ctx.lineWidth = 2; ctx.beginPath()
        r.trail.forEach((p, j) => j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke()
        if (r.vy > -1.5) { burst(r.x, r.y, r.color); rockets.splice(i, 1) }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]; s.x += s.vx; s.y += s.vy; s.vy += 0.07; s.vx *= 0.985; s.vy *= 0.985; s.age++
        const k = 1 - s.age / s.life; ctx.globalAlpha = Math.max(k, 0); ctx.fillStyle = s.color
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size * (0.6 + k), 0, Math.PI * 2); ctx.fill()
        if (s.age >= s.life) sparks.splice(i, 1)
      }
      ctx.globalAlpha = 1; t++; raf = requestAnimationFrame(frame)
    }
    for (let i = 0; i < 4; i++) setTimeout(launch, i * 250)
    frame()
    return () => { alive = false; cancelAnimationFrame(raf); removeEventListener('resize', resize) }
  }, [show])

  if (!show) return null
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none', overflow: 'hidden' }} aria-live="polite">
      <style>{`
        @keyframes tc-run { from { transform: translateX(100vw); } to { transform: translateX(-100%); } }
        @keyframes tc-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.35); } }
      `}</style>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, rgba(27,52,100,.08), rgba(27,52,100,.28))' }} />
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', top: '30%', left: 0, whiteSpace: 'nowrap', animation: `tc-run ${BANNER_PASS_S}s linear ${BANNER_PASSES}`, textAlign: 'center' }}>
        <div style={{ fontSize: 'clamp(48px, 7.5vw, 120px)', fontWeight: 900, letterSpacing: '.02em', color: '#e11d2e', lineHeight: 1.05,
          textShadow: '0 0 18px rgba(255,255,255,.9), 0 6px 0 #9f1220, 0 12px 30px rgba(0,0,0,.35)' }}>
          🎉 Congrats on the tender submission! 🎉
        </div>
        <div style={{ fontSize: 'clamp(16px, 2vw, 30px)', fontWeight: 700, color: '#1B3464', textShadow: '0 0 10px #fff', letterSpacing: '.15em', textTransform: 'uppercase', marginTop: 8 }}>
          RDMC Engineering &amp; Project Team in Action · 10 September 2026
        </div>
        <div style={{ display: 'inline-block', marginTop: 14, fontSize: 'clamp(28px, 4vw, 64px)', fontWeight: 900, color: '#7c3aed',
          textShadow: '0 0 14px rgba(255,255,255,.95), 0 4px 0 #4c1d95', animation: 'tc-pulse 1.4s ease-in-out infinite', transformOrigin: 'center' }}>
          So Proud!
        </div>
      </div>
      <button type="button" onClick={() => setShow(false)}
        style={{ position: 'absolute', top: 14, right: 18, pointerEvents: 'auto', background: 'rgba(255,255,255,.92)', border: '1px solid #cbd5e1',
          borderRadius: 999, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#334155' }}>
        Close ✕
      </button>
    </div>
  )
}
