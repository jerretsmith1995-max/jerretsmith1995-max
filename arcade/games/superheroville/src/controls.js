// Keyboard + gamepad input, with "just pressed" edge detection.
// Keyboard: arrows/WASD move, Space/Z/Up jump, Shift/X run + shoot, Enter pause, Esc back to the arcade.
// Gamepad (Xbox/PlayStation/Switch Pro): D-pad or stick, A/B jump, X/Y run + shoot, Start pause.
(function () {
  'use strict';
  class Controls {
    constructor(scene) {
      this.scene = scene;
      const K = Phaser.Input.Keyboard.KeyCodes;
      this.keys = scene.input.keyboard.addKeys({
        left: K.LEFT, right: K.RIGHT, up: K.UP, down: K.DOWN,
        a: K.A, d: K.D, w: K.W, s: K.S,
        space: K.SPACE, z: K.Z, x: K.X, shift: K.SHIFT, c: K.C,
        enter: K.ENTER, p: K.P, esc: K.ESC, m: K.M,
      });
      // Stop the browser scrolling the page with arrows/space.
      scene.input.keyboard.addCapture([K.LEFT, K.RIGHT, K.UP, K.DOWN, K.SPACE]);
      this.prev = {};
      this.state = {};
      this.virtual = window.TOUCH_STATE || null; // optional on-screen buttons
      // Remember key presses that happen between frames, so quick taps are never lost.
      this.latch = {};
      const names = {
        [K.LEFT]: ['left'], [K.A]: ['left'], [K.RIGHT]: ['right'], [K.D]: ['right'],
        [K.UP]: ['up', 'jump'], [K.W]: ['up', 'jump'], [K.DOWN]: ['down'], [K.S]: ['down'],
        [K.SPACE]: ['jump', 'confirm'], [K.Z]: ['jump', 'confirm'],
        [K.X]: ['run'], [K.SHIFT]: ['run'], [K.C]: ['run'],
        [K.ENTER]: ['start', 'confirm'], [K.P]: ['start'], [K.ESC]: ['back'], [K.M]: ['mute'],
      };
      this.onKey = e => { if (!e.repeat && names[e.keyCode]) names[e.keyCode].forEach(n => { this.latch[n] = true; }); };
      scene.input.keyboard.on('keydown', this.onKey);
      scene.events.once('shutdown', () => scene.input.keyboard.off('keydown', this.onKey));
    }
    pad() {
      const gp = this.scene.input.gamepad;
      if (!gp || !gp.total) return null;
      return gp.getPad(0) || gp.pad1 || null;
    }
    read() {
      const k = this.keys, p = this.pad(), v = this.virtual || {};
      const btn = i => !!(p && p.buttons[i] && p.buttons[i].pressed);
      const ax = p && p.axes.length ? p.axes[0].getValue() : 0;
      const ay = p && p.axes.length > 1 ? p.axes[1].getValue() : 0;
      return {
        left: k.left.isDown || k.a.isDown || btn(14) || ax < -0.4 || !!v.left,
        right: k.right.isDown || k.d.isDown || btn(15) || ax > 0.4 || !!v.right,
        up: k.up.isDown || k.w.isDown || btn(12) || ay < -0.5,
        down: k.down.isDown || k.s.isDown || btn(13) || ay > 0.5,
        jump: k.space.isDown || k.z.isDown || k.up.isDown || k.w.isDown || btn(0) || btn(1) || !!v.jump,
        run: k.shift.isDown || k.x.isDown || k.c.isDown || btn(2) || btn(3) || !!v.run,
        start: k.enter.isDown || k.p.isDown || btn(9) || !!v.start,
        back: k.esc.isDown || btn(8),
        mute: k.m.isDown,
        confirm: k.enter.isDown || k.space.isDown || k.z.isDown || btn(0) || btn(9) || !!v.jump || !!v.start,
      };
    }
    update() {
      this.prev = this.state;
      this.state = this.read();
      // Quick taps on the on-screen buttons (see touch.js).
      const v = this.virtual;
      if (v && v.taps) {
        const map = { jump: ['jump', 'confirm'], start: ['start', 'confirm'], run: ['run'], left: ['left'], right: ['right'] };
        Object.keys(v.taps).forEach(k => (map[k] || []).forEach(n => { this.latch[n] = true; }));
        v.taps = {};
      }
      this.edges = {};
      Object.keys(this.state).forEach(n => { this.edges[n] = (this.state[n] && !this.prev[n]) || !!this.latch[n]; });
      Object.keys(this.latch).forEach(n => { if (this.latch[n] && !this.state[n]) this.edges[n] = true; });
      this.latch = {};
    }
    held(name) { return !!this.state[name]; }
    pressed(name) { return !!(this.edges && this.edges[name]); }
  }
  window.Controls = Controls;
})();
