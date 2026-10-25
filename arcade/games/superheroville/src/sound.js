// Chiptune sound: an NES-style synth (2 pulse channels, triangle bass, noise drums)
// built on the Web Audio API. All music here is original.
(function () {
  'use strict';
  let ctx = null, master, musicGain, sfxGain, noiseBuf, pulse25, pulse125;
  let muted = false;
  try { muted = localStorage.getItem('shv_muted') === '1'; } catch (e) { /* no storage */ }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.32; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.42; sfxGain.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    pulse25 = makePulse(0.25); pulse125 = makePulse(0.125);
  }
  function makePulse(duty) {
    const n = 64, real = new Float32Array(n), imag = new Float32Array(n);
    for (let i = 1; i < n; i++) real[i] = (2 * Math.sin(i * Math.PI * duty)) / (i * Math.PI);
    return ctx.createPeriodicWave(real, imag);
  }
  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('shv_muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (master) master.gain.value = m ? 0 : 0.6;
  }

  const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  function freq(name) {
    const m = /^([A-G][#b]?)(\d)$/.exec(name);
    if (!m) return 0;
    const midi = 12 * (+m[2] + 1) + NOTE[m[1]];
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // One synth voice: osc type ('p25','p125','sq','tri'), start time, duration, frequency, volume.
  function tone(dest, type, t, dur, f, vol, slideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    if (type === 'p25') o.setPeriodicWave(pulse25);
    else if (type === 'p125') o.setPeriodicWave(pulse125);
    else o.type = type === 'tri' ? 'triangle' : type === 'saw' ? 'sawtooth' : 'square';
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.setValueAtTime(vol, t + Math.max(0.01, dur * 0.7));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dest, t, dur, vol, cutoff, hp) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = hp ? 'highpass' : 'lowpass'; f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------------ SOUND EFFECTS
  const SFX = {
    jump:   t => tone(sfxGain, 'p25', t, 0.16, 240, 0.35, 720),
    jumpBig:t => tone(sfxGain, 'p25', t, 0.2, 180, 0.35, 620),
    stomp:  t => { tone(sfxGain, 'sq', t, 0.09, 560, 0.3, 180); noise(sfxGain, t, 0.06, 0.3, 2000); },
    candy:  t => { tone(sfxGain, 'p25', t, 0.06, freq('B5'), 0.3); tone(sfxGain, 'p25', t + 0.06, 0.32, freq('E6'), 0.3); },
    bump:   t => tone(sfxGain, 'tri', t, 0.1, 160, 0.5, 70),
    breakb: t => { noise(sfxGain, t, 0.3, 0.45, 1400); tone(sfxGain, 'sq', t, 0.08, 300, 0.2, 90); },
    appear: t => ['C5', 'G5', 'C6', 'E6', 'G6'].forEach((n, i) => tone(sfxGain, 'p25', t + i * 0.04, 0.06, freq(n), 0.22)),
    power:  t => ['C5', 'E5', 'G5', 'C6', 'D5', 'F#5', 'A5', 'D6', 'E5', 'G#5', 'B5', 'E6'].forEach((n, i) => tone(sfxGain, 'p25', t + i * 0.045, 0.07, freq(n), 0.25)),
    oneup:  t => ['E5', 'G5', 'E6', 'C6', 'D6', 'G6'].forEach((n, i) => tone(sfxGain, 'p25', t + i * 0.08, 0.1, freq(n), 0.28)),
    blast:  t => { tone(sfxGain, 'p125', t, 0.12, 1400, 0.25, 300); noise(sfxGain, t, 0.05, 0.12, 4000, true); },
    kick:   t => { tone(sfxGain, 'sq', t, 0.06, 900, 0.25, 400); noise(sfxGain, t, 0.05, 0.25, 3000); },
    hurt:   t => ['B4', 'F#4', 'D4', 'B3'].forEach((n, i) => tone(sfxGain, 'p25', t + i * 0.07, 0.09, freq(n), 0.3)),
    knock:  t => { [0, 0.22].forEach(d => { noise(sfxGain, t + d, 0.12, 0.8, 380); tone(sfxGain, 'tri', t + d, 0.12, 110, 0.6, 60); }); },
    slide:  t => tone(sfxGain, 'p25', t, 0.9, 1200, 0.18, 200),
    tick:   t => tone(sfxGain, 'p125', t, 0.03, 1760, 0.12),
    pause:  t => { tone(sfxGain, 'p25', t, 0.06, freq('E6'), 0.25); tone(sfxGain, 'p25', t + 0.1, 0.06, freq('C6'), 0.25); tone(sfxGain, 'p25', t + 0.2, 0.12, freq('E6'), 0.25); },
    select: t => tone(sfxGain, 'p25', t, 0.06, freq('A5'), 0.25),
    confirm:t => { tone(sfxGain, 'p25', t, 0.08, freq('C6'), 0.28); tone(sfxGain, 'p25', t + 0.08, 0.16, freq('G6'), 0.28); },
    howl:   t => { tone(sfxGain, 'tri', t, 0.9, 320, 0.4, 640); tone(sfxGain, 'p125', t, 0.9, 322, 0.08, 642); },
    bossHit:t => { tone(sfxGain, 'sq', t, 0.25, 400, 0.35, 60); noise(sfxGain, t, 0.2, 0.3, 1200); },
    flap:   t => noise(sfxGain, t, 0.05, 0.12, 900),
  };
  function sfx(name) {
    if (!ctx || muted) return;
    const f = SFX[name];
    if (f) f(ctx.currentTime + 0.005);
  }

  // ------------------------------------------------------------------ MUSIC
  // Tracks are strings of space-separated steps: a note ("E5"), "_" (hold) or "-" (rest).
  // Drum steps: k = kick, s = snare, h = hat, - = rest.
  const SONGS = {
    street: { // Superheroville Street: bouncy with a spooky minor bridge
      bpm: 150, step: 0.5, // eighth notes
      lead: 'E5 _ G5 E5 C5 _ D5 E5 | F5 _ E5 D5 C5 _ - - | A4 _ C5 A4 G4 _ A4 C5 | D5 _ C5 B4 C5 _ - G4 | ' +
            'E5 E5 G5 _ A5 G5 E5 C5 | D5 _ F5 _ E5 D5 C5 _ | A4 C5 E5 _ D5 C5 B4 G4 | C5 _ _ _ - - - - | ' +
            'C5 _ Eb5 _ D5 _ C5 _ | Bb4 _ G4 _ Ab4 _ G4 _ | C5 _ Eb5 _ G5 _ F5 Eb5 | D5 _ B4 _ G4 _ - - | ' +
            'C5 _ Eb5 _ D5 _ C5 _ | Bb4 _ G4 _ Ab4 _ Bb4 _ | B4 _ D5 _ F5 _ D5 _ | G5 _ _ _ - - G4 B4',
      harm: 'C5 _ - C5 G4 _ - G4 | A4 _ - A4 G4 _ - - | E4 _ - E4 E4 _ - E4 | F4 _ - F4 E4 _ - - | ' +
            'C5 _ - C5 E5 _ - C5 | A4 _ - A4 G4 _ - G4 | E4 _ - E4 F4 _ - D4 | E4 _ _ _ - - - - | ' +
            'G4 _ - G4 G4 _ - G4 | F4 _ - F4 Eb4 _ - Eb4 | G4 _ - G4 Bb4 _ - Ab4 | G4 _ - G4 D4 _ - - | ' +
            'G4 _ - G4 G4 _ - G4 | F4 _ - F4 Eb4 _ - F4 | G4 _ - G4 B4 _ - B4 | D5 _ _ _ - - - -',
      bass: 'C3 - G3 - C3 - G3 - | F2 - C3 - F2 - C3 - | A2 - E3 - A2 - E3 - | G2 - D3 - G2 - B2 - | ' +
            'C3 - G3 - C3 - G3 - | D3 - A3 - G2 - D3 - | A2 - E3 - F2 - G2 - | C3 - G2 - C3 - - - | ' +
            'C3 - G3 - C3 - G3 - | Bb2 - F3 - Ab2 - Eb3 - | C3 - G3 - Ab2 - Eb3 - | G2 - D3 - G2 - D3 - | ' +
            'C3 - G3 - C3 - G3 - | Bb2 - F3 - Ab2 - Bb2 - | G2 - D3 - G2 - B2 - | G2 - D3 - G2 - B2 -',
      drum: 'k h s h k h s h | k h s h k h s h | k h s h k h s h | k h s h k h s s',
    },
    crypt: { // the Creepy Crypt: sparse, minor, plinky
      bpm: 132, step: 0.5,
      lead: 'A4 - C5 - E5 - D5 - | C5 - B4 - G#4 - - - | A4 - C5 - E5 - G5 - | F5 - E5 - D5 - - - | ' +
            'F5 _ E5 _ D5 _ C5 _ | B4 _ C5 _ D5 _ E5 _ | A4 - - - E5 - - - | A5 _ _ _ - - - -',
      harm: '- - - - - - - - | - - - - - - - - | - - E4 - - - E4 - | - - D4 - - - - - | ' +
            'A4 _ G4 _ F4 _ E4 _ | D4 _ E4 _ F4 _ G#4 _ | - - - - - - - - | - - - - - - - -',
      bass: 'A2 - A3 - A2 - A3 - | E2 - E3 - E2 - E3 - | A2 - A3 - C3 - C4 - | D3 - D4 - E2 - E3 - | ' +
            'F2 - F3 - F2 - F3 - | E2 - E3 - E2 - G#2 - | A2 - A3 - A2 - A3 - | A2 - E3 - A2 - - -',
      drum: 'k - h - s - h - | k - h - s - h h',
    },
    roof: { // Rooftop Run: driving, adventurous
      bpm: 160, step: 0.5,
      lead: 'D5 _ A4 _ D5 E5 F5 _ | E5 _ C5 _ A4 _ - - | D5 _ A4 _ D5 E5 F5 A5 | G5 _ F5 _ E5 _ - - | ' +
            'Bb4 _ D5 _ F5 _ Bb5 _ | A5 _ G5 _ F5 _ E5 _ | D5 E5 F5 G5 A5 _ G5 F5 | E5 _ C#5 _ A4 _ - -',
      harm: 'F4 _ - - F4 - A4 _ | G4 _ - - E4 _ - - | F4 _ - - F4 - A4 - | Bb4 _ - - A4 _ - - | ' +
            'F4 _ - - D4 _ - - | C5 _ - - A4 _ - - | F4 - A4 - D5 _ - - | A4 _ E4 _ C#4 _ - -',
      bass: 'D3 D3 A3 D3 D3 D3 A3 D3 | A2 A2 E3 A2 A2 A2 E3 A2 | D3 D3 A3 D3 D3 D3 A3 D3 | G2 G2 D3 G2 A2 A2 E3 A2 | ' +
            'Bb2 Bb2 F3 Bb2 Bb2 Bb2 F3 Bb2 | F2 F2 C3 F2 C3 C3 G3 C3 | D3 D3 A3 D3 G2 G2 D3 G2 | A2 A2 E3 A2 A2 - - -',
      drum: 'k h s h k k s h | k h s h k k s s',
    },
    castle: { // Count Snoozula's castle: tense and dramatic
      bpm: 140, step: 0.5,
      lead: 'E4 F4 E4 D#4 E4 _ - - | E4 F4 E4 D#4 E4 _ - - | G4 Ab4 G4 F#4 G4 _ - - | Bb4 A4 Ab4 G4 F#4 _ - - | ' +
            'E5 _ D5 _ C5 _ B4 _ | C5 _ A4 _ F4 _ - - | E5 _ F5 _ G5 _ Ab5 _ | G5 _ _ _ - - - -',
      harm: '- - - - B3 _ - - | - - - - B3 _ - - | - - - - D4 _ - - | - - - - C4 _ - - | ' +
            'A4 _ G4 _ E4 _ D4 _ | E4 _ C4 _ A3 _ - - | C5 _ D5 _ E5 _ F5 _ | B4 _ _ _ - - - -',
      bass: 'E2 E2 E3 E2 E2 E2 E3 E2 | E2 E2 E3 E2 E2 E2 E3 E2 | G2 G2 G3 G2 G2 G2 G3 G2 | F2 F2 F3 F2 F#2 F#2 F#3 F#2 | ' +
            'A2 A2 A3 A2 G2 G2 G3 G2 | F2 F2 F3 F2 D2 D2 D3 D2 | C3 C3 C4 C3 D3 D3 D4 D3 | E2 E2 E3 E2 E2 - - -',
      drum: 'k - k s k - k s | k - k s k k s s',
    },
    star: { // Hero Star power: fast and bright
      bpm: 190, step: 0.5,
      lead: 'C5 E5 G5 C6 G5 E5 C5 E5 | D5 F5 A5 D6 A5 F5 D5 F5 | E5 G5 B5 E6 B5 G5 E5 G5 | F5 A5 C6 F6 G5 B5 D6 G6',
      harm: '- - - - - - - - | - - - - - - - - | - - - - - - - - | - - - - - - - -',
      bass: 'C3 C4 C3 C4 C3 C4 C3 C4 | D3 D4 D3 D4 D3 D4 D3 D4 | E3 E4 E3 E4 E3 E4 E3 E4 | F3 F4 F3 F4 G3 G4 G3 G4',
      drum: 'k h s h k h s h',
    },
    title: { // title screen: a spooky-fun swing in A minor
      bpm: 120, step: 0.5,
      lead: 'A4 _ C5 E5 _ C5 A4 _ | G4 _ B4 D5 _ B4 G4 _ | F4 _ A4 C5 _ A4 F4 _ | E4 _ G#4 B4 _ D5 C5 B4 | ' +
            'A4 _ C5 E5 _ A5 G5 E5 | F5 _ E5 D5 _ C5 B4 _ | C5 _ A4 F4 _ D5 C5 B4 | A4 _ _ _ - - - -',
      harm: 'E4 _ - - - - E4 _ | D4 _ - - - - D4 _ | C4 _ - - - - C4 _ | B3 _ - - - - - - | ' +
            'C4 _ - - - - C4 _ | A4 _ - - - - G4 _ | A4 _ - - - - G#4 _ | E4 _ _ _ - - - -',
      bass: 'A2 - E3 - A2 - E3 - | G2 - D3 - G2 - D3 - | F2 - C3 - F2 - C3 - | E2 - B2 - E2 - G#2 - | ' +
            'A2 - E3 - A2 - E3 - | D2 - A2 - D2 - A2 - | F2 - C3 - E2 - B2 - | A2 - E2 - A2 - - -',
      drum: 'k - h s - h k h | k - h s - h k s',
    },
    clear: { // level clear fanfare (plays once)
      bpm: 160, step: 0.5, once: true,
      lead: 'G4 C5 E5 G5 C6 E6 G6 _ E6 _ | Ab4 C5 Eb5 Ab5 C6 Eb6 Ab6 _ Eb6 _ | Bb4 D5 F5 Bb5 D6 F6 Bb6 _ Bb6 Bb6 | C7 _ _ _ _ _ - - - -',
      harm: 'E4 - - - - - E5 _ C5 _ | Eb4 - - - - - Eb5 _ C5 _ | F4 - - - - - F5 _ F5 F5 | E5 _ _ _ _ _ - - - -',
      bass: 'C3 _ _ _ _ _ C3 _ G2 _ | Ab2 _ _ _ _ _ Ab2 _ Eb3 _ | Bb2 _ _ _ _ _ Bb2 _ Bb2 Bb2 | C3 _ _ _ _ _ - - - -',
      drum: '- - - - - - - - - - | - - - - - - - - - - | - - - - - - - - k k | k - - - - - - - - -',
    },
    death: { // oops (plays once)
      bpm: 140, step: 0.5, once: true,
      lead: 'C5 C#5 D5 - - - B4 F5 - F5 F5 E5 D5 _ C5 E4 - E4 C4 _ _ _',
      harm: '- - - - - - - - - - - - - - - - - - - - - -',
      bass: '- - - - - - G2 - - G2 G2 A2 B2 _ C3 G2 - E2 C2 _ _ _',
      drum: '- - - - - - - - - - - - - - - - - - - - - -',
    },
    gameover: {
      bpm: 100, step: 0.5, once: true,
      lead: 'C5 - G4 - E4 _ A4 _ B4 _ A4 _ G#4 _ Bb4 _ G#4 _ G4 F4 G4 _ _ _',
      harm: '- - - - - - - - - - - - - - - - - - - - - - - -',
      bass: 'C3 - G2 - E2 _ F2 _ F2 _ F2 _ Db3 _ Db3 _ Db3 _ C3 _ C3 _ _ _',
      drum: '- - - - - - - - - - - - - - - - - - - - - - - -',
    },
  };

  function parse(str) { return str.replace(/\|/g, ' ').trim().split(/\s+/); }
  Object.values(SONGS).forEach(s => {
    s.tracks = { lead: parse(s.lead), harm: parse(s.harm), bass: parse(s.bass), drum: parse(s.drum) };
    s.length = s.tracks.lead.length;
  });

  let current = null, timer = null, stepIndex = 0, nextTime = 0, speed = 1;

  function holdLen(track, i, len) {
    let n = 1;
    while (track[(i + n) % len] === '_' && n < len) n++;
    return n;
  }

  function scheduleStep(song, i, t) {
    const secPerStep = (60 / song.bpm) * song.step / speed;
    const T = song.tracks;
    const play = (track, type, vol, octShift) => {
      const tr = T[track];
      const n = tr[i % tr.length];
      if (!n || n === '-' || n === '_') return;
      const f = freq(n) * (octShift || 1);
      const dur = holdLen(tr, i % tr.length, tr.length) * secPerStep * 0.95;
      tone(musicGain, type, t, dur, f, vol);
    };
    play('lead', 'p25', 0.2);
    play('harm', 'p125', 0.11);
    play('bass', 'tri', 0.42);
    const d = T.drum[i % T.drum.length];
    if (d === 'k') { noise(musicGain, t, 0.08, 0.5, 300); tone(musicGain, 'tri', t, 0.08, 120, 0.5, 50); }
    else if (d === 's') noise(musicGain, t, 0.1, 0.35, 2600);
    else if (d === 'h') noise(musicGain, t, 0.03, 0.12, 7000, true);
    return secPerStep;
  }

  function tick() {
    if (!current || !ctx) return;
    while (nextTime < ctx.currentTime + 0.12) {
      if (current.once && stepIndex >= current.length) { current = null; return; }
      const dt = scheduleStep(current, stepIndex, nextTime);
      nextTime += dt;
      stepIndex = current.once ? stepIndex + 1 : (stepIndex + 1) % current.length;
    }
  }

  let currentName = null;
  function music(name, opts) {
    if (!ctx) return;
    if (name === currentName && current && !(opts && opts.restart)) return;
    current = SONGS[name] || null;
    currentName = name;
    speed = (opts && opts.speed) || 1;
    stepIndex = 0;
    nextTime = ctx.currentTime + 0.05;
    if (!timer) timer = setInterval(tick, 25);
  }
  function stopMusic() { current = null; currentName = null; }
  function setSpeed(s) { speed = s; }

  window.SOUND = { init, sfx, music, stopMusic, setSpeed, setMuted, isMuted: () => muted, get playing() { return currentName; } };
})();
