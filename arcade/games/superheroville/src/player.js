// The player: Sonny, Dada or Mama. Movement is tuned to feel like the classic Mario games:
// acceleration and skidding, a run button, variable jump height (hold to jump higher),
// a higher jump when running, plus small modern helpers (coyote time, jump buffering).
(function () {
  'use strict';

  // Speeds in pixels per second at 16px tiles. The classic NES values are about
  // 94 px/s walking and 154 px/s running; these are a touch snappier.
  const BASE = {
    walkMax: 96, runMax: 156,
    accWalk: 220, accRun: 320, accAir: 240,
    decel: 280, skid: 640,
    jumpV: 262, jumpVRun: 296,
    gHold: 470, gHoldRun: 560, gFall: 1500,
    maxFall: 280,
    coyote: 0.08, buffer: 0.11,
  };
  const CHAR_STATS = {
    sonny: {},
    dada: { runMax: 178, accRun: 360, jumpV: 256, jumpVRun: 292, gHold: 490 },
    mama: { runMax: 148, float: 0.9 },
  };

  const FRAME = { idle: 0, walk1: 1, walk2: 2, walk3: 3, jump: 4, skid: 5, dead: 6, knock: 7, glide: 8, fly: 9 };

  class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, charKey, form) {
      super(scene, x, y, `${charKey}_${form}`, 0);
      scene.add.existing(this);
      scene.physics.add.existing(this);
      this.charKey = charKey;
      this.form = form;
      this.stats = Object.assign({}, BASE, CHAR_STATS[charKey]);
      this.body.setSize(10, 22).setOffset(3, 2);
      this.body.setAllowGravity(false);
      this.body.setMaxVelocity(400, 600);
      this.body.setCollideWorldBounds(true); // the world bounds only block left/right, so pits still work
      this.setDepth(10);
      this.facing = 1;
      this.coyote = 0; this.buffer = 0;
      this.rising = false;     // still in the "holding jump" part of a jump
      this.runJump = false;
      this.floatLeft = 0;      // Mama's hover
      this.fuel = 1;           // Rocket Suit flight fuel (seconds)
      this.flying = false;
      this.star = 0;           // Hero Star seconds left
      this.invuln = 0;         // flashing after getting hurt
      this.dead = false;
      this.locked = false;     // cutscenes (flagpole, door)
      this.walkTime = 0;
      this.shootCooldown = 0;
      this.wasGrounded = true;
    }

    setForm(form) {
      this.form = form;
      this.setTexture(`${this.charKey}_${form}`, this.frame.name);
    }

    get grounded() { return this.body.blocked.down || this.body.touching.down; }

    update(dt, ctl) {
      if (this.dead) return;
      const s = this.stats, b = this.body;
      if (this.invuln > 0) { this.invuln -= dt; this.setAlpha(Math.floor(this.invuln * 20) % 2 ? 0.35 : 1); if (this.invuln <= 0) this.setAlpha(1); }
      if (this.star > 0) {
        this.star -= dt;
        const cols = [0xffff66, 0x66ffff, 0xff88ff, 0xffffff];
        this.setTint(cols[Math.floor(this.star * 15) % cols.length]);
        if (this.star <= 0) { this.clearTint(); this.scene.events.emit('starEnd'); }
      }
      if (this.shootCooldown > 0) this.shootCooldown -= dt;
      if (this.locked) return;

      const grounded = this.grounded;
      if (grounded) { this.coyote = s.coyote; this.fuel = 1; this.floatLeft = s.float || 0; this.flying = false; }
      else this.coyote -= dt;

      // Horizontal
      const left = ctl.held('left'), right = ctl.held('right'), run = ctl.held('run');
      const dir = (right ? 1 : 0) - (left ? 1 : 0);
      const max = run ? s.runMax : s.walkMax;
      let vx = b.velocity.x;
      let skidding = false;
      if (dir !== 0) {
        if (grounded && vx * dir < 0) { vx += dir * s.skid * dt; skidding = Math.abs(vx) > 20; }
        else {
          const acc = grounded ? (run ? s.accRun : s.accWalk) : s.accAir;
          if (Math.abs(vx) < max || vx * dir < 0) vx += dir * acc * dt;
          if (vx * dir > max) vx = Math.max(Math.abs(vx) - s.decel * dt, max) * dir; // ease down to walk speed
        }
        if (grounded || !this.rising) this.facing = dir;
      } else if (grounded) {
        const d = s.decel * dt;
        vx = Math.abs(vx) <= d ? 0 : vx - Math.sign(vx) * d;
      }
      // Jumping
      if (ctl.pressed('jump')) this.buffer = s.buffer; else this.buffer -= dt;
      if (this.buffer > 0 && this.coyote > 0) {
        this.runJump = Math.abs(vx) > s.walkMax + 20;
        b.velocity.y = -(this.runJump ? s.jumpVRun : s.jumpV);
        this.rising = true; this.buffer = 0; this.coyote = 0;
        SOUND.sfx(this.form === 'pajamas' ? 'jump' : 'jumpBig');
      }
      let vy = b.velocity.y;
      if (this.rising && (!ctl.held('jump') || vy >= 0)) this.rising = false;
      let g = this.rising ? (this.runJump ? s.gHoldRun : s.gHold) : s.gFall;
      let maxFall = s.maxFall;

      // Rocket Suit: press jump again in the air to fly for a moment.
      if (this.form === 'rocket' && !grounded && !this.rising) {
        if (ctl.pressed('jump') && this.fuel > 0) this.flying = true;
        if (this.flying && ctl.held('jump') && this.fuel > 0) {
          this.fuel -= dt;
          vy = Math.max(vy - 1400 * dt, -170);
          g = 0;
          if (Math.random() < 0.3) this.scene.events.emit('jetpuff', this.x - this.facing * 5, this.y + 8);
        } else this.flying = false;
      }
      // Hero Cape: hold jump while falling to glide.
      const gliding = this.form === 'hero' && !grounded && vy > 0 && ctl.held('jump');
      if (gliding) maxFall = 55;
      // Mama: hold jump at the top of a jump to hover.
      let floating = false;
      if (s.float && !grounded && vy >= -10 && ctl.held('jump') && this.floatLeft > 0 && !gliding) {
        this.floatLeft -= dt; vy = Math.min(vy, 12 * Math.sin(this.floatLeft * 12)); g = 0; floating = true;
      }

      vy = Math.min(vy + g * dt, maxFall);
      b.velocity.x = vx; b.velocity.y = vy;

      // Rocket blasts
      if (this.form === 'rocket' && ctl.pressed('run') && this.shootCooldown <= 0) {
        if (this.scene.shootBlast(this)) { this.shootCooldown = 0.25; SOUND.sfx('blast'); }
      }

      // Animation
      this.setFlipX(this.facing < 0);
      let frame;
      if (!grounded) {
        if (this.flying) frame = 'fly';
        else if (gliding) frame = 'glide';
        else frame = 'jump';
        if (floating) frame = 'jump';
      } else if (skidding) frame = 'skid';
      else if (Math.abs(vx) > 4) {
        this.walkTime += dt * (2 + Math.abs(vx) / 18);
        frame = ['walk1', 'walk2', 'walk3', 'walk2'][Math.floor(this.walkTime) % 4];
      } else frame = 'idle';
      this.setFrame(FRAME[frame]);
      this.wasGrounded = grounded;
    }

    bounce(held) {
      this.body.velocity.y = held ? -320 : -230;
      this.rising = held;
      this.runJump = false;
      this.coyote = 0;
      if (this.stats.float) this.floatLeft = this.stats.float;
      this.fuel = Math.max(this.fuel, 0.5);
    }

    die() {
      if (this.dead) return;
      this.dead = true;
      this.clearTint(); this.setAlpha(1);
      this.setFrame(FRAME.dead);
      this.body.setVelocity(0, 0);
      this.body.enable = false;
      this.setDepth(50);
      const scene = this.scene;
      scene.tweens.add({ targets: this, y: this.y - 40, duration: 450, ease: 'Quad.easeOut', delay: 400,
        onComplete: () => scene.tweens.add({ targets: this, y: this.y + 300, duration: 1100, ease: 'Quad.easeIn' }) });
    }

    setPose(name) { this.setFrame(FRAME[name]); }
  }

  window.Player = Player;
  window.PLAYER_FRAME = FRAME;
})();
