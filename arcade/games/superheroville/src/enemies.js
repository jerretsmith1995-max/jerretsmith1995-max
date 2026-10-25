// Monsters and power-up items.
(function () {
  'use strict';

  // ---------------------------------------------------------------- MONSTERS
  class Enemy extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, key, type) {
      super(scene, x, y, key, 0);
      scene.add.existing(this);
      scene.physics.add.existing(this);
      this.type = type;
      this.awake = false;
      this.alive = true;
      this.dir = -1;
      this.speed = 30;
      this.animTime = 0;
      this.setDepth(5);
      this.body.enable = false;
      this.setVisible(true);
      this.points = 100;
      this.stompable = true;
      this.harmful = true;
      this.turnAtLedge = false;
    }
    wake() { this.awake = true; this.body.enable = true; }
    walk(dt) {
      const b = this.body;
      if (b.blocked.left) this.dir = 1;
      else if (b.blocked.right) this.dir = -1;
      if (this.turnAtLedge && b.blocked.down && !this.scene.solidAt(this.x + this.dir * 8, this.y + this.height / 2 + 4)) this.dir *= -1;
      b.velocity.x = this.dir * this.speed;
    }
    animate(dt, rate) {
      this.animTime += dt * (rate || 5);
      this.setFrame(Math.floor(this.animTime) % 2);
    }
    update(dt) {}
    // Returns true if the player should bounce.
    stomp() {
      this.die(true);
      return true;
    }
    // Killed by a shell, rocket blast, Hero Star or a bumped block: flip over and fall off screen.
    hit() {
      if (!this.alive) return;
      this.alive = false;
      this.setFlipY(true);
      this.body.checkCollision.none = true;
      this.body.setAllowGravity(true);
      this.body.setVelocity(this.dir * -40, -220);
      this.scene.time.delayedCall(2000, () => this.destroy());
    }
    die() { this.hit(); }
  }

  class Skelly extends Enemy {
    constructor(scene, x, y) { super(scene, x, y, 'skelly', 'skelly'); this.body.setSize(12, 14).setOffset(2, 2); this.speed = 32; }
    update(dt) { if (!this.alive) return; this.walk(dt); this.animate(dt, 5); }
    stomp() {
      this.alive = false;
      this.body.enable = false;
      this.setTexture('skelly_squish', 0);
      this.scene.events.emit('bones', this.x, this.y);
      this.scene.time.delayedCall(500, () => this.destroy());
      return true;
    }
  }

  // Pumpkin: stomp it into a shell, kick the shell into other monsters.
  class Jack extends Enemy {
    constructor(scene, x, y) { super(scene, x, y, 'jack', 'jack'); this.body.setSize(12, 13).setOffset(2, 2); this.speed = 28; this.state = 'walk'; this.kickGrace = 0; }
    update(dt) {
      if (!this.alive) return;
      if (this.kickGrace > 0) this.kickGrace -= dt;
      if (this.state === 'walk') { this.walk(dt); this.animate(dt, 4); this.setFlipX(this.dir > 0); }
      else if (this.state === 'shell') { this.body.velocity.x = 0; this.setFrame(0); }
      else if (this.state === 'spin') {
        const b = this.body;
        if (b.blocked.left) { this.dir = 1; SOUND.sfx('bump'); }
        else if (b.blocked.right) { this.dir = -1; SOUND.sfx('bump'); }
        b.velocity.x = this.dir * 210;
        this.animTime += dt * 14; this.setFrame(Math.floor(this.animTime) % 2);
      }
    }
    toShell() {
      this.state = 'shell';
      this.setTexture('jack_shell', 0);
      this.body.setSize(12, 10).setOffset(2, 4);
      this.points = 100;
    }
    kick(fromX) {
      this.state = 'spin';
      this.dir = this.x >= fromX ? 1 : -1;
      this.kickGrace = 0.2;
      SOUND.sfx('kick');
    }
    stomp(player) {
      if (this.state === 'walk') { this.toShell(); return true; }
      if (this.state === 'shell') { this.kick(player.x); return true; }
      this.state = 'shell'; return true;
    }
    get dangerous() { return this.state === 'walk' || (this.state === 'spin' && this.kickGrace <= 0); }
  }

  class Bat extends Enemy {
    constructor(scene, x, y) {
      super(scene, x, y, 'bat', 'bat');
      this.body.setSize(12, 8).setOffset(2, 2);
      this.baseY = y; this.t = Math.random() * 6;
      this.points = 200;
    }
    wake() { super.wake(); this.body.setAllowGravity(false); }
    update(dt) {
      if (!this.alive) return;
      this.t += dt;
      this.body.velocity.x = this.dir * 42;
      this.y = this.baseY + Math.sin(this.t * 3) * 18;
      this.body.velocity.y = 0;
      this.animate(dt, 8);
      if (Math.floor(this.t * 8) % 8 === 0 && Math.random() < 0.05) SOUND.sfx('flap');
    }
  }

  class Mummy extends Enemy {
    constructor(scene, x, y) { super(scene, x, y, 'mummy', 'mummy'); this.body.setSize(10, 21).setOffset(3, 2); this.speed = 22; this.turnAtLedge = true; this.points = 200; }
    update(dt) { if (!this.alive) return; this.walk(dt); this.animate(dt, 3); this.setFlipX(this.dir > 0); }
  }

  // Werewolf: walks and hops.
  class Wolf extends Enemy {
    constructor(scene, x, y) { super(scene, x, y, 'wolf', 'wolf'); this.body.setSize(10, 20).setOffset(3, 3); this.speed = 36; this.hopTimer = 1 + Math.random(); this.points = 200; }
    update(dt) {
      if (!this.alive) return;
      this.walk(dt);
      this.hopTimer -= dt;
      if (this.body.blocked.down && this.hopTimer <= 0) {
        this.body.velocity.y = -260; this.hopTimer = 1.4;
        if (Math.random() < 0.3) SOUND.sfx('howl');
      }
      this.setFrame(this.body.blocked.down ? Math.floor((this.animTime += dt * 4)) % 2 : 1);
      this.setFlipX(this.dir > 0);
    }
  }

  // Shy ghost: floats toward you while your back is turned; hides its face when you look at it.
  class Ghost extends Enemy {
    constructor(scene, x, y) { super(scene, x, y, 'ghost', 'ghost'); this.body.setSize(12, 12).setOffset(2, 2); this.points = 200; this.alpha = 0.92; }
    wake() { super.wake(); this.body.setAllowGravity(false); this.body.checkCollision.none = false; }
    update(dt) {
      if (!this.alive) return;
      const p = this.scene.player;
      if (!p || p.dead) { this.body.setVelocity(0, 0); return; }
      const looking = (p.facing > 0 && this.x > p.x) || (p.facing < 0 && this.x < p.x);
      if (looking) { this.body.setVelocity(0, 0); this.setFrame(1); }
      else {
        const dx = p.x - this.x, dy = p.y - this.y, d = Math.max(1, Math.hypot(dx, dy));
        this.body.setVelocity(dx / d * 34, dy / d * 34);
        this.setFrame(0);
        this.setFlipX(dx > 0);
      }
    }
  }

  // Zombie hand that pops up out of a pipe. It won't come out while you stand right next to the pipe.
  class Hand extends Enemy {
    constructor(scene, x, y) {
      super(scene, x, y, 'hand', 'hand');
      this.topY = y - 12; this.hideY = y + 12;
      this.y = this.hideY;
      this.stompable = false;
      this.phase = 'hidden'; this.timer = 1 + Math.random();
      this.setDepth(1);
      this.points = 200;
    }
    wake() { super.wake(); this.body.setAllowGravity(false); this.body.setImmovable(true); this.body.setSize(10, 20).setOffset(3, 2); }
    update(dt) {
      if (!this.alive) return;
      this.timer -= dt;
      const p = this.scene.player;
      if (this.phase === 'hidden' && this.timer <= 0) {
        if (p && Math.abs(p.x - this.x) < 28) this.timer = 0.3;
        else { this.phase = 'rise'; this.timer = 0.7; }
      } else if (this.phase === 'rise') {
        this.y = Phaser.Math.Linear(this.hideY, this.topY, 1 - Math.max(0, this.timer) / 0.7);
        if (this.timer <= 0) { this.phase = 'up'; this.timer = 1.3; }
      } else if (this.phase === 'up' && this.timer <= 0) { this.phase = 'lower'; this.timer = 0.7; }
      else if (this.phase === 'lower') {
        this.y = Phaser.Math.Linear(this.topY, this.hideY, 1 - Math.max(0, this.timer) / 0.7);
        if (this.timer <= 0) { this.phase = 'hidden'; this.timer = 1.6; }
      }
      this.body.reset(this.x, this.y);
      this.harmful = this.phase !== 'hidden';
      this.animate(dt, 3);
    }
    hit() { this.alive = false; this.body.enable = false; this.scene.tweens.add({ targets: this, y: this.hideY + 10, alpha: 0, duration: 300, onComplete: () => this.destroy() }); }
  }

  // A bat thrown by Count Snoozula.
  class ThrownBat extends Enemy {
    constructor(scene, x, y, dir) {
      super(scene, x, y, 'bat', 'thrownbat');
      this.wake(); this.body.setAllowGravity(false); this.body.setSize(12, 8).setOffset(2, 2);
      this.dir = dir; this.t = 0; this.baseY = y;
      this.body.checkCollision.none = false;
      this.points = 100;
    }
    update(dt) {
      if (!this.alive) return;
      this.t += dt;
      this.body.velocity.x = this.dir * 90;
      this.y = this.baseY + Math.sin(this.t * 6) * 8;
      this.animate(dt, 10);
      if (this.t > 6) this.destroy();
    }
  }

  // Count Snoozula: World 1 boss. Three stomps on the head make him too sleepy to fight.
  class Vampire extends Enemy {
    constructor(scene, x, y, arena) {
      super(scene, x, y, 'vampire', 'vampire');
      this.body.setSize(22, 28).setOffset(5, 4);
      this.hp = 3; this.speed = 40; this.arena = arena;
      this.throwTimer = 2; this.hopTimer = 1.5; this.stun = 0;
      this.points = 5000;
      this.setDepth(6);
    }
    update(dt) {
      if (!this.alive) return;
      const b = this.body, p = this.scene.player;
      if (this.stun > 0) {
        this.stun -= dt; b.velocity.x = 0;
        this.setAlpha(Math.floor(this.stun * 16) % 2 ? 0.4 : 1);
        if (this.stun <= 0) this.setAlpha(1);
        return;
      }
      if (this.x < this.arena.left + 16) this.dir = 1;
      if (this.x > this.arena.right - 16) this.dir = -1;
      if (b.blocked.left) this.dir = 1; else if (b.blocked.right) this.dir = -1;
      b.velocity.x = this.dir * this.speed * (1 + (3 - this.hp) * 0.35);
      this.hopTimer -= dt;
      if (b.blocked.down && this.hopTimer <= 0) { b.velocity.y = -300; this.hopTimer = 1.2 + Math.random() * 1.2; }
      this.throwTimer -= dt;
      if (this.throwTimer <= 0 && p && !p.dead) {
        this.throwTimer = 2.4 - (3 - this.hp) * 0.5;
        const d = p.x < this.x ? -1 : 1;
        this.scene.spawnEnemy(new ThrownBat(this.scene, this.x + d * 12, this.y - 4, d));
        SOUND.sfx('flap');
      }
      this.setFlipX(p && p.x > this.x);
      this.setFrame(0);
    }
    stomp() {
      if (this.stun > 0) return true;
      this.hp--;
      SOUND.sfx('bossHit');
      this.scene.cameras.main.shake(200, 0.01);
      if (this.hp <= 0) { this.alive = false; this.scene.bossDefeated(this); return true; }
      this.stun = 1.2;
      return true;
    }
    hit() { // rocket blasts and shells only make him flinch
      if (this.stun > 0 || !this.alive) return;
      this.stun = 0.4;
      SOUND.sfx('bump');
    }
  }

  const ENEMY_TYPES = { skelly: Skelly, jack: Jack, bat: Bat, mummy: Mummy, wolf: Wolf, ghost: Ghost, hand: Hand };

  // ---------------------------------------------------------------- ITEMS
  // Power-ups pop out of blocks, then behave like the classic mushroom (cape, egg),
  // flower (rocket: stays put) or star (bounces).
  class Item extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, kind) {
      super(scene, x, y, kind, 0);
      scene.add.existing(this);
      scene.physics.add.existing(this);
      this.kind = kind;
      this.body.enable = false;
      this.setDepth(4);
      this.dir = 1;
      this.emerging = true;
      this.animTime = 0;
      scene.tweens.add({
        targets: this, y: y - 16, duration: 650, onComplete: () => {
          this.emerging = false;
          this.body.enable = true;
          this.body.setSize(12, 14).setOffset(2, 2);
          if (kind === 'rocket') { this.body.setAllowGravity(false); this.body.setImmovable(true); }
          if (kind === 'star') this.body.velocity.y = -180;
        },
      });
      this.setDepth(2);
    }
    update(dt) {
      if (this.emerging || !this.body) return;
      this.setDepth(4);
      const b = this.body;
      this.animTime += dt * 6;
      if (this.kind === 'rocket') { this.setFrame(Math.floor(this.animTime) % 2); return; }
      if (b.blocked.left) this.dir = 1; else if (b.blocked.right) this.dir = -1;
      b.velocity.x = this.dir * (this.kind === 'star' ? 72 : 56);
      if (this.kind === 'star' && b.blocked.down) b.velocity.y = -230;
      if (this.y > 260) this.destroy();
    }
  }

  window.ENEMIES = { Enemy, Skelly, Jack, Bat, Mummy, Wolf, Ghost, Hand, ThrownBat, Vampire, ENEMY_TYPES, Item };
})();
