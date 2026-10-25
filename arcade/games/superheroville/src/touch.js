// On-screen controls for phones and tablets. Only shown on touch screens (or with ?touch=1).
// Left thumb: slide on the D-pad. Right thumb: A = jump, B = run / shoot.
(function () {
  'use strict';
  window.TOUCH_STATE = window.TOUCH_STATE || {};
  const forced = /[?&]touch=1/.test(location.search);
  const isTouch = forced || (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  window.IS_TOUCH = isTouch;
  if (!isTouch) return;

  const css = `
    html, body { touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; overscroll-behavior: none; }
    #tc { position: fixed; inset: 0; pointer-events: none; z-index: 5; font-family: system-ui, -apple-system, sans-serif; }
    #tc .b { position: absolute; pointer-events: auto; touch-action: none; display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 800; border: 3px solid rgba(255,255,255,0.4); background: rgba(255,255,255,0.07); border-radius: 50%; }
    #tc .b.on { background: rgba(255,210,63,0.45); border-color: #ffd23f; }
    #tc-pad { left: calc(env(safe-area-inset-left, 0px) + 2vw); bottom: calc(env(safe-area-inset-bottom, 0px) + 4vh);
      width: min(36vh, 156px); height: min(19vh, 82px); border-radius: 42px !important; font-size: min(6vh, 26px); gap: min(11vh, 46px); }
    #tc-pad span { opacity: 0.85; transition: transform 60ms; }
    #tc-pad span.on { color: #ffd23f; transform: scale(1.25); }
    #tc-a, #tc-b { width: min(19vh, 80px); height: min(19vh, 80px); font-size: min(6.5vh, 28px); }
    #tc-a { right: calc(env(safe-area-inset-right, 0px) + 2vw); bottom: calc(env(safe-area-inset-bottom, 0px) + 15vh); }
    #tc-b { right: calc(env(safe-area-inset-right, 0px) + 2vw + min(21vh, 88px)); bottom: calc(env(safe-area-inset-bottom, 0px) + 4vh); }
    #tc-pause, #tc-home { top: calc(env(safe-area-inset-top, 0px) + 2vh); width: min(13vh, 56px); height: min(10vh, 42px); border-radius: 21px !important; font-size: min(4.5vh, 18px); }
    #tc-pause { right: calc(env(safe-area-inset-right, 0px) + 2vw); }
    #tc-home { left: calc(env(safe-area-inset-left, 0px) + 2vw); }
    #tc-rotate { position: fixed; inset: 0; z-index: 20; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
      background: #0a0618; color: #ffd23f; font: 800 22px system-ui, sans-serif; text-align: center; padding: 24px; }
    #tc-rotate small { color: #c8c2ee; font-weight: 600; font-size: 15px; }
    #tc-rotate .phone { width: 46px; height: 80px; border: 4px solid #ffd23f; border-radius: 10px; animation: tcturn 1.6s ease-in-out infinite; }
    @keyframes tcturn { 0%, 30% { transform: rotate(0deg); } 60%, 100% { transform: rotate(-90deg); } }
    @media (orientation: portrait) { #tc-rotate { display: flex; } }
    @media (prefers-reduced-motion: reduce) { #tc-rotate .phone { animation: none; transform: rotate(-90deg); } }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function build() {
    const root = document.createElement('div');
    root.id = 'tc';
    root.innerHTML = `
      <div class="b" id="tc-pad" aria-label="Move"><span data-d="left">&#9664;</span><span data-d="right">&#9654;</span></div>
      <div class="b" id="tc-b" aria-label="Run">B</div>
      <div class="b" id="tc-a" aria-label="Jump">A</div>
      <div class="b" id="tc-pause" aria-label="Pause">II</div>
      <div class="b" id="tc-home" aria-label="Menu">&#8962;</div>`;
    document.body.appendChild(root);
    const rot = document.createElement('div');
    rot.id = 'tc-rotate';
    rot.innerHTML = '<div class="phone"></div>Turn your phone sideways<small>Superheroville plays in landscape</small>';
    document.body.appendChild(rot);

    const S = window.TOUCH_STATE;
    // Remember quick taps so the game sees them even if the finger lifts before the next frame.
    const tap = key => { S.taps = S.taps || {}; S.taps[key] = true; };
    // Simple buttons: hold to press.
    const hold = (id, key) => {
      const el = document.getElementById(id);
      const on = e => { e.preventDefault(); S[key] = true; tap(key); el.classList.add('on'); };
      const off = e => { e.preventDefault(); S[key] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.addEventListener(t, off));
    };
    hold('tc-a', 'jump'); hold('tc-b', 'run'); hold('tc-pause', 'start');
    document.getElementById('tc-home').addEventListener('pointerup', e => { e.preventDefault(); if (window.exitToArcade) window.exitToArcade(); });

    // D-pad: slide your thumb left and right without lifting it.
    const pad = document.getElementById('tc-pad');
    const arrows = pad.querySelectorAll('span');
    let padPointer = null;
    const setDir = (x) => {
      const r = pad.getBoundingClientRect();
      const left = x < r.left + r.width / 2;
      if (S.left !== left || S.right !== !left) tap(left ? 'left' : 'right');
      S.left = left; S.right = !left;
      arrows[0].classList.toggle('on', left); arrows[1].classList.toggle('on', !left);
    };
    const clearDir = () => { S.left = false; S.right = false; arrows.forEach(a => a.classList.remove('on')); padPointer = null; };
    pad.addEventListener('pointerdown', e => {
      e.preventDefault(); padPointer = e.pointerId;
      try { pad.setPointerCapture(e.pointerId); } catch (err) { /* not every browser allows capture */ }
      setDir(e.clientX);
    });
    pad.addEventListener('pointermove', e => { if (e.pointerId === padPointer) setDir(e.clientX); });
    ['pointerup', 'pointercancel'].forEach(t => pad.addEventListener(t, e => { if (e.pointerId === padPointer) clearDir(); }));
  }

  // iPhone only allows sound to start inside a tap, so wake the audio on the first touch.
  const unlock = () => { if (window.SOUND) SOUND.init(); };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('touchend', unlock, true);
  // Stop pinch-zoom and double-tap zoom.
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
