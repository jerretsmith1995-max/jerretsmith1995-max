// The level scene: tiles, blocks, monsters, power-ups, the flagpole and the door knock.
(function () {
  'use strict';
  const T = LEVELS.T;
  const TS = 16;
  const COMBO = [100, 200, 400, 800, 1000, 2000, 4000, 8000];

  class GameScene extends Phaser.Scene {
    constructor() { super('Game'); }

    init(data) {
      this.levelIndex = data.levelIndex || 0;
      this.fromCheckpoint = !!data.fromCheckpoint;
    }

    create() {
      const def = this.def = LEVELS.list[this.levelIndex]();
      GAME.lastLevel = this.levelIndex;
      this.ctl = new Controls(this);
      this.W = def.width * TS;
      this.finished = false;
      this.paused = false;
      this.combo = 0;
      this.bossActive = false;
      this.physics.world.setBounds(0, -200, this.W, 600, true, true, false, false);

      this.makeBackground(def);

      // Tiles
      const map = this.map = this.make.tilemap({ data: def.grid, tileWidth: TS, tileHeight: TS });
      const tiles = map.addTilesetImage('tiles', 'tiles_' + def.theme, TS, TS, 0, 0);
      this.layer = map.createLayer(0, tiles, 0, 0);
      this.layer.setCollisionByExclusion([-1, T.PLANK, T.GOO]);
      this.layer.forEachTile(t => { if (t.index === T.PLANK) t.setCollision(false, false, true, false); });
      this.layer.setDepth(0);

      // Scenery
      def.decor.forEach(d => this.add.image(d.x * TS, d.y * TS, d.key, 0).setOrigin(0, 1).setDepth(-2));
      if (def.goalX !== null && def.goalX !== undefined) this.makeGoal(def);

      // Animated candy blocks sit on top of their tiles.
      this.blockSprites = {};
      Object.entries(def.contents).forEach(([key, c]) => {
        const [x, y] = key.split(',').map(Number);
        if (!c.hidden && def.grid[y][x] === T.BLOCK) {
          this.blockSprites[key] = this.add.sprite(x * TS + 8, y * TS + 8, 'block_anim', 0).play('block_shimmer').setDepth(1);
        }
      });
      this.revealed = {};

      // Groups
      this.walkers = this.physics.add.group({ allowGravity: true });
      this.fliers = this.physics.add.group({ allowGravity: false });
      this.items = this.physics.add.group();
      this.candies = this.physics.add.staticGroup();
      this.blasts = this.physics.add.group({ allowGravity: false });
      this.lifts = this.physics.add.group({ allowGravity: false, immovable: true });
      this.allEnemies = [];

      def.items.forEach(it => {
        const c = this.candies.create(it.x * TS + 8, it.y * TS + 8, 'candy', 0);
        c.play('candy_spin'); c.body.setSize(10, 10);
      });
      def.enemies.forEach(e => {
        const Cls = ENEMIES.ENEMY_TYPES[e.type];
        if (!Cls) return;
        const h = e.type === 'mummy' || e.type === 'wolf' ? 24 : e.type === 'bat' ? 12 : 16;
        const en = new Cls(this, e.x * TS + 8, (e.y + 1) * TS - h / 2, e.type);
        this.spawnEnemy(en, true);
      });
      def.lifts.forEach(l => this.makeLift(l));
      this.firebars = def.firebars.map(f => ({
        cx: f.x * TS + 8, cy: f.y * TS + 8, len: f.len, speed: f.speed, angle: 0,
        balls: Array.from({ length: f.len }, () => this.add.image(0, 0, 'fire').setDepth(6)),
      }));

      // Player
      let sx = def.start.x * TS + 8, sy = def.start.y * TS + 4;
      if (this.fromCheckpoint && def.checkpointX) { sx = def.checkpointX * TS + 8; sy = this.groundYAt(def.checkpointX) - 12; }
      this.player = new Player(this, sx, sy, GAME.character, GAME.form);
      this.checkpointHit = this.fromCheckpoint;

      // Physics relationships
      this.physics.add.collider(this.player, this.layer);
      this.physics.add.collider(this.player, this.lifts, (p, lift) => { if (p.body.touching.down) p.x += lift.body.deltaX(); });
      this.physics.add.collider(this.walkers, this.layer);
      this.physics.add.collider(this.walkers, this.lifts);
      this.physics.add.collider(this.items, this.layer);
      this.physics.add.collider(this.walkers, this.walkers, null, (a, b) => this.walkerBump(a, b));
      this.physics.add.overlap(this.player, this.walkers, (p, e) => this.touchEnemy(e));
      this.physics.add.overlap(this.player, this.fliers, (p, e) => this.touchEnemy(e));
      this.physics.add.overlap(this.walkers, this.fliers, (a, b) => this.walkerBump(a, b));
      this.physics.add.overlap(this.player, this.items, (p, it) => this.collectItem(it));
      this.physics.add.overlap(this.player, this.candies, (p, c) => this.collectCandy(c));
      this.physics.add.collider(this.blasts, this.layer, b => this.popBlast(b));
      this.physics.add.overlap(this.blasts, this.walkers, (b, e) => this.blastHit(b, e));
      this.physics.add.overlap(this.blasts, this.fliers, (b, e) => this.blastHit(b, e));

      // Camera
      const cam = this.cameras.main;
      cam.setBounds(0, 0, this.W, 224);
      cam.startFollow(this.player, true, 0.2, 0, -16, 0);
      cam.setRoundPixels(true);

      this.makeHud();
      this.timeLeft = def.time; this.timeAcc = 0; this.hurried = false;
      SOUND.music(def.music, { restart: true });

      this.events.on('bones', (x, y) => this.debris('px_bone', x, y, 6));
      this.events.on('jetpuff', (x, y) => this.puff(x, y));
      this.events.on('starEnd', () => { if (!this.finished && !this.player.dead) SOUND.music(this.def.music, { restart: true, speed: this.hurried ? 1.25 : 1 }); });
      this.cameras.main.fadeIn(250, 0, 0, 0);
      window.__shv = this; // handy for automated tests
    }

    // ------------------------------------------------------------ setup helpers
    makeBackground(def) {
      const theme = def.theme;
      this.add.image(0, 0, 'sky_' + theme).setOrigin(0).setScrollFactor(0).setDisplaySize(400, 224).setDepth(-20);
      this.bgLayers = [];
      const layer = (key, y, factor, depth, tint, alpha) => {
        const tex = this.textures.get(key).getSourceImage();
        const ts = this.add.tileSprite(0, y, 400, tex.height, key).setOrigin(0).setScrollFactor(0).setDepth(depth);
        if (tint) ts.setTint(tint);
        if (alpha) ts.setAlpha(alpha);
        this.bgLayers.push({ ts, factor });
      };
      if (theme === 'street' || theme === 'roof') {
        this.add.image(0, 0, 'stars').setOrigin(0).setScrollFactor(0).setDepth(-19);
        this.add.image(320, 40, 'moon').setScrollFactor(0).setDepth(-18);
        layer('houses_far', theme === 'roof' ? 120 : 92, 0.12, -17);
        layer('trees', 134, 0.25, -16);
        if (theme === 'street') layer('houses_near', 114, 0.45, -15, 0x9a8ac8, 0.85);
        else layer('houses_near', 150, 0.45, -15);
      } else if (theme === 'crypt') {
        layer('houses_far', 100, 0.1, -17, 0x2a2a3a, 0.5);
      } else if (theme === 'castle') {
        this.add.image(0, 0, 'stars').setOrigin(0).setScrollFactor(0).setDepth(-19).setAlpha(0.4);
        layer('houses_far', 100, 0.1, -17, 0x3a2030, 0.6);
      }
    }

    makeGoal(def) {
      const px = def.goalX * TS + 8;
      this.pole = { x: px, top: 16, bottom: 11 * TS };
      this.add.image(px, 11 * TS, 'flagpole').setOrigin(0.5, 1).setDepth(-1);
      this.flag = this.add.image(px - 8, 26, 'flag').setOrigin(0.5, 0.5).setDepth(-1);
      const hx = (def.goalX + 5) * TS;
      this.houseDoorX = hx + 48;
      this.add.image(hx, 12 * TS, def.goalSpooky ? 'house_villain' : 'house_hero').setOrigin(0, 1).setDepth(-1);
    }

    makeLift(l) {
      const lift = this.add.tileSprite(l.x * TS, l.y * TS, l.w * TS, 6, 'plank').setOrigin(0);
      this.physics.add.existing(lift);
      this.lifts.add(lift);
      lift.body.setImmovable(true); lift.body.setAllowGravity(false);
      lift.body.checkCollision.down = false; lift.body.checkCollision.left = false; lift.body.checkCollision.right = false;
      lift.cfg = l; lift.t = 0; lift.baseX = lift.x; lift.baseY = lift.y;
      lift.setDepth(1);
    }

    spawnEnemy(en, fromLevel) {
      const groundless = en.type === 'bat' || en.type === 'ghost' || en.type === 'hand' || en.type === 'thrownbat';
      (groundless ? this.fliers : this.walkers).add(en);
      if (groundless) en.body.setAllowGravity(false);
      if (!fromLevel) en.awake = true;
      this.allEnemies.push(en);
      return en;
    }

    groundYAt(tx) {
      for (let y = 2; y < LEVELS.ROWS; y++) {
        const t = this.def.grid[y][tx];
        if (t !== -1 && t !== T.GOO) return y * TS;
      }
      return 12 * TS;
    }

    solidAt(x, y) {
      const t = this.layer.getTileAtWorldXY(x, y);
      return !!(t && t.collides);
    }

    // ------------------------------------------------------------ HUD
    makeHud() {
      const mk = (x, y, txt, tint) => {
        const sh = this.add.bitmapText(x + 1, y + 1, 'font', txt).setScrollFactor(0).setDepth(99).setTint(0x000000);
        const t = this.add.bitmapText(x, y, 'font', txt).setScrollFactor(0).setDepth(100);
        if (tint) t.setTint(tint);
        return { set: s => { if (t.text !== s) { t.setText(s); sh.setText(s); } }, t, sh };
      };
      const name = ART.CHARACTERS[GAME.character].name;
      this.hud = {
        name: mk(16, 6, name + ' x' + GAME.lives, 0xffd23f),
        score: mk(16, 16, '000000'),
        candy: mk(132, 16, 'x00'),
        world: mk(210, 6, 'WORLD', 0xffd23f),
        level: mk(216, 16, LEVELS.names[this.levelIndex]),
        time: mk(330, 6, 'TIME', 0xffd23f),
        timeV: mk(336, 16, '400'),
      };
      this.add.sprite(124, 19, 'candy', 0).setScrollFactor(0).setDepth(100).play('candy_spin');
    }
    refreshHud() {
      const h = this.hud;
      h.name.set(ART.CHARACTERS[GAME.character].name + ' x' + GAME.lives);
      h.score.set(String(GAME.score).padStart(6, '0'));
      h.candy.set('x' + String(GAME.candy).padStart(2, '0'));
      h.timeV.set(String(Math.max(0, Math.ceil(this.timeLeft))).padStart(3, '0'));
    }
    popup(x, y, text, tint) {
      const t = this.add.bitmapText(x, y, 'font', text).setOrigin(0.5).setDepth(60);
      if (tint) t.setTint(tint);
      this.tweens.add({ targets: t, y: y - 24, alpha: 0, duration: 800, delay: 200, onComplete: () => t.destroy() });
    }
    addScore(n, x, y) {
      GAME.score += n;
      if (x !== undefined) this.popup(x, y, String(n));
    }
    oneUp(x, y) {
      GAME.lives++;
      SOUND.sfx('oneup');
      if (x !== undefined) this.popup(x, y, '1UP', 0x7aff7a);
    }

    // ------------------------------------------------------------ main loop
    update(time, deltaMs) {
      const dt = Math.min(deltaMs / 1000, 1 / 30);
      const ctl = this.ctl;
      ctl.update();
      if (ctl.pressed('back')) { exitToArcade(); return; }
      if (ctl.pressed('mute')) SOUND.setMuted(!SOUND.isMuted());
      if (this.paused) { if (ctl.pressed('start')) this.togglePause(); return; }
      if (ctl.pressed('start') && !this.finished && !this.player.dead) { this.togglePause(); return; }

      const p = this.player;
      this.bgLayers.forEach(l => { l.ts.tilePositionX = this.cameras.main.scrollX * l.factor; });

      if (!p.dead) {
        this.checkHiddenBlocks();
        if (p.body.blocked.up && !p.locked) this.headBump();
        p.update(dt, ctl);
        if (p.grounded) this.combo = 0;
        this.prevTop = p.body.top;
      }

      // Wake monsters as they come on screen.
      const camR = this.cameras.main.scrollX + 400 + 32, camL = this.cameras.main.scrollX - 64;
      for (let i = this.allEnemies.length - 1; i >= 0; i--) {
        const e = this.allEnemies[i];
        if (!e.active || !e.scene) { this.allEnemies.splice(i, 1); continue; }
        if (!e.awake && e.x < camR) e.wake();
        if (e.awake && e.alive) {
          e.update(dt);
          if (e.y > 280 || (e.type !== 'vampire' && e.x < camL - 300)) e.destroy();
        }
      }
      this.items.getChildren().forEach(it => it.update(dt));
      this.updateLifts(dt);
      this.updateFirebars(dt);
      this.blasts.getChildren().forEach(b => { if (Math.abs(b.x - p.x) > 260) b.destroy(); });

      if (!p.dead && !this.finished) {
        // Falling into a pit or into the potion.
        if (p.y > 240) this.playerDied(true);
        else {
          const tile = this.layer.getTileAtWorldXY(p.x, p.body.bottom - 2);
          if (tile && tile.index === T.GOO) this.playerDied(true);
        }
        if (!this.checkpointHit && this.def.checkpointX && p.x > this.def.checkpointX * TS) {
          this.checkpointHit = true;
          GAME.checkpoint = this.levelIndex;
        }
        if (this.pole && p.body.right >= this.pole.x - 1 && !p.locked) this.startGoal();
        if (this.def.boss && !this.bossActive && p.x > (this.def.boss.x - 12) * TS) this.startBoss();
        this.timeAcc += dt;
        if (this.timeAcc >= 0.4) {
          this.timeAcc -= 0.4; this.timeLeft -= 1;
          if (this.timeLeft === 100 && !this.hurried) { this.hurried = true; SOUND.sfx('pause'); SOUND.setSpeed(1.25); }
          if (this.timeLeft <= 0) this.playerDied(false);
        }
      }
      this.refreshHud();
    }

    togglePause() {
      this.paused = !this.paused;
      SOUND.sfx('pause');
      if (this.paused) {
        this.physics.pause(); this.tweens.pauseAll(); this.anims.pauseAll();
        this.pauseOverlay = [
          this.add.rectangle(0, 0, 400, 224, 0x000000, 0.55).setOrigin(0).setScrollFactor(0).setDepth(200),
          this.add.bitmapText(200, 96, 'font', 'PAUSED').setOrigin(0.5).setScale(2).setScrollFactor(0).setDepth(201).setTint(0xffd23f),
          this.add.bitmapText(200, 128, 'font', window.IS_TOUCH ? 'TAP II TO KEEP PLAYING' : 'ENTER: KEEP PLAYING').setOrigin(0.5).setScrollFactor(0).setDepth(201),
          this.add.bitmapText(200, 142, 'font', window.IS_TOUCH ? 'TAP THE HOUSE BUTTON FOR THE MENU' : 'ESC: BACK TO THE ARCADE').setOrigin(0.5).setScrollFactor(0).setDepth(201),
        ];
      } else {
        this.physics.resume(); this.tweens.resumeAll(); this.anims.resumeAll();
        this.pauseOverlay.forEach(o => o.destroy());
      }
    }

    // ------------------------------------------------------------ blocks
    headBump() {
      const p = this.player, b = p.body;
      if (this.bumpCooldown && this.time.now < this.bumpCooldown) return;
      const ty = Math.floor((b.top - 2) / TS);
      const cands = [Math.floor((b.left + 1) / TS), Math.floor((b.right - 1) / TS)]
        .map(tx => this.layer.getTileAt(tx, ty))
        .filter(t => t && t.collides && t.index !== T.PLANK);
      if (!cands.length) return;
      cands.sort((a, c) => Math.abs(a.getCenterX() - p.x) - Math.abs(c.getCenterX() - p.x));
      this.bumpCooldown = this.time.now + 120;
      this.bumpBlock(cands[0]);
    }

    checkHiddenBlocks() {
      const p = this.player, b = p.body;
      if (b.velocity.y >= 0 || this.prevTop === undefined) return;
      Object.entries(this.def.contents).forEach(([key, c]) => {
        if (!c.hidden || this.revealed[key]) return;
        const [x, y] = key.split(',').map(Number);
        const bottom = (y + 1) * TS;
        if (b.top < bottom && this.prevTop >= bottom - 1 && b.right > x * TS + 2 && b.left < x * TS + 14) {
          this.revealed[key] = true;
          const tile = this.layer.putTileAt(T.USED, x, y);
          tile.setCollision(true, true, true, true);
          p.y += bottom - b.top; b.velocity.y = 0; p.rising = false;
          this.spawnItemFrom(x, y, c.kind === 'oneup' ? 'egg' : c.kind);
          this.bumpEffect(x, y, T.USED);
        }
      });
    }

    bumpBlock(tile) {
      const x = tile.x, y = tile.y, key = x + ',' + y;
      const c = this.def.contents[key];
      const p = this.player;
      if (tile.index === T.BRICK && !c) {
        if (p.form !== 'pajamas') {
          this.layer.removeTileAt(x, y);
          SOUND.sfx('breakb');
          this.debris('brick_' + this.def.theme, x * TS + 8, y * TS + 8, 4, true);
          this.addScore(50);
          this.hitThingsOnTop(x, y);
        } else { SOUND.sfx('bump'); this.bumpEffect(x, y, T.BRICK); this.hitThingsOnTop(x, y); }
        return;
      }
      if (!c || c.used) { SOUND.sfx('bump'); return; }
      this.hitThingsOnTop(x, y);
      if (c.kind === 'candy' || c.kind === 'multi') {
        this.candyPop(x, y);
        if (c.kind === 'multi') { c.count--; if (c.count > 0) { this.bumpEffect(x, y, T.BRICK); return; } }
      } else if (c.kind === 'power') this.spawnItemFrom(x, y, p.form === 'pajamas' ? 'cape' : 'rocket');
      else if (c.kind === 'star') this.spawnItemFrom(x, y, 'star');
      else if (c.kind === 'oneup') this.spawnItemFrom(x, y, 'egg');
      c.used = true;
      if (this.blockSprites[key]) { this.blockSprites[key].destroy(); delete this.blockSprites[key]; }
      this.bumpEffect(x, y, T.USED, true);
    }

    // Little hop animation for a bumped block. If `become` is set the tile changes to it after.
    bumpEffect(x, y, finalIndex, change) {
      const tile = this.layer.getTileAt(x, y);
      if (!tile) return;
      tile.setVisible(false);
      const spr = this.add.image(x * TS + 8, y * TS + 8, 'tiles_' + this.def.theme, change ? T.USED : tile.index).setDepth(2);
      this.tweens.add({
        targets: spr, y: spr.y - 6, duration: 70, yoyo: true, onComplete: () => {
          spr.destroy();
          const t = change ? this.layer.putTileAt(finalIndex, x, y) : this.layer.getTileAt(x, y);
          if (t) { t.setVisible(true); t.setCollision(true, true, true, true); }
        },
      });
    }

    hitThingsOnTop(x, y) {
      const top = y * TS, l = x * TS, r = l + TS;
      this.allEnemies.forEach(e => {
        if (!e.alive || !e.awake || !e.body) return;
        if (Math.abs(e.body.bottom - top) < 4 && e.body.right > l && e.body.left < r) { e.hit(); this.addScore(100, e.x, e.y - 10); SOUND.sfx('kick'); }
      });
      this.items.getChildren().forEach(it => {
        if (it.body && Math.abs(it.body.bottom - top) < 4 && it.body.right > l && it.body.left < r) { it.body.velocity.y = -220; it.dir = it.x < l + 8 ? -1 : 1; }
      });
      this.candies.getChildren().forEach(c => { if (Math.abs(c.y - (top - 8)) < 4 && Math.abs(c.x - (l + 8)) < 6) this.collectCandy(c); });
    }

    candyPop(x, y) {
      SOUND.sfx('candy');
      this.gainCandy();
      this.addScore(200);
      const s = this.add.sprite(x * TS + 8, y * TS - 4, 'candy', 0).play('candy_spin').setDepth(3);
      this.tweens.add({ targets: s, y: s.y - 36, duration: 260, yoyo: true, ease: 'Quad.easeOut', onComplete: () => { this.popup(s.x, s.y, '200'); s.destroy(); } });
    }

    spawnItemFrom(x, y, kind) {
      SOUND.sfx('appear');
      const it = new ENEMIES.Item(this, x * TS + 8, y * TS + 8, kind);
      this.items.add(it);
      it.body.enable = false;
      if (kind === 'rocket') it.body.setAllowGravity(false);
      return it;
    }

    // ------------------------------------------------------------ collisions
    walkerBump(a, b) {
      const spinA = a instanceof ENEMIES.Jack && a.state === 'spin';
      const spinB = b instanceof ENEMIES.Jack && b.state === 'spin';
      if (!a.alive || !b.alive) return false;
      if (spinA || spinB) {
        const victim = spinA ? b : a, shell = spinA ? a : b;
        if (victim instanceof ENEMIES.Vampire) { victim.hit(); shell.hit(); return false; }
        victim.hit(); SOUND.sfx('kick');
        this.combo++;
        this.addScore(COMBO[Math.min(this.combo, COMBO.length - 1)], victim.x, victim.y - 10);
        return false;
      }
      if (a.body && b.body && a.body.allowGravity && b.body.allowGravity) {
        a.dir = a.x < b.x ? -1 : 1; b.dir = -a.dir;
      }
      return false;
    }

    touchEnemy(e) {
      const p = this.player;
      if (p.dead || p.locked || !e.alive || !e.awake) return;
      if (p.star > 0 && !(e instanceof ENEMIES.Vampire)) {
        e.hit(); SOUND.sfx('kick'); this.combo++;
        this.addScore(COMBO[Math.min(this.combo, COMBO.length - 1)], e.x, e.y - 10);
        return;
      }
      if (e instanceof ENEMIES.Jack && e.state === 'shell') { e.kick(p.x); this.addScore(400, e.x, e.y - 10); return; }
      if (!e.harmful) return;
      const falling = p.body.velocity.y > 0 || p.body.bottom < e.body.top + 6;
      const above = p.body.bottom <= e.body.top + 9;
      if (e.stompable && falling && above) {
        e.stomp(p);
        p.bounce(this.ctl.held('jump'));
        SOUND.sfx('stomp');
        this.combo++;
        const pts = COMBO[Math.min(this.combo - 1, COMBO.length - 1)];
        if (this.combo > COMBO.length) this.oneUp(e.x, e.y - 10); else this.addScore(pts, e.x, e.y - 10);
        return;
      }
      if (e instanceof ENEMIES.Jack && e.state === 'spin' && e.kickGrace > 0) return;
      if (p.star > 0) return; // the Hero Star protects you from the boss too
      this.hurtPlayer();
    }

    hurtPlayer() {
      const p = this.player;
      if (p.invuln > 0 || p.dead) return;
      if (p.form === 'pajamas') { this.playerDied(false); return; }
      const next = p.form === 'rocket' ? 'hero' : 'pajamas';
      GAME.form = next;
      p.setForm(next);
      p.invuln = 2;
      SOUND.sfx('hurt');
    }

    collectItem(it) {
      if (it.emerging || !it.active) return;
      const p = this.player;
      const k = it.kind;
      it.destroy();
      if (k === 'egg') { this.oneUp(p.x, p.y - 16); return; }
      this.addScore(1000, p.x, p.y - 16);
      if (k === 'star') { p.star = 10; SOUND.sfx('power'); SOUND.music('star', { restart: true }); return; }
      let form = p.form;
      if (k === 'cape' && form === 'pajamas') form = 'hero';
      if (k === 'rocket') form = 'rocket';
      SOUND.sfx('power');
      if (form !== p.form) {
        GAME.form = form;
        // Classic transformation flicker between old and new outfits.
        const old = p.form;
        let n = 0;
        this.time.addEvent({ delay: 70, repeat: 9, callback: () => { n++; p.setForm(n % 2 ? form : old); if (n >= 10) p.setForm(form); } });
        this.time.delayedCall(720, () => p.setForm(form));
      }
    }

    collectCandy(c) {
      if (!c.active) return;
      c.destroy();
      SOUND.sfx('candy');
      this.gainCandy();
      this.addScore(200);
    }
    gainCandy() {
      GAME.candy++;
      if (GAME.candy >= 100) { GAME.candy -= 100; this.oneUp(this.player.x, this.player.y - 20); }
    }

    // ------------------------------------------------------------ Rocket Suit blasts
    shootBlast(p) {
      if (this.blasts.countActive() >= 2) return false;
      const b = this.blasts.create(p.x + p.facing * 8, p.y - 2, 'blast', 0);
      b.body.setAllowGravity(false);
      b.body.setSize(6, 6);
      b.body.velocity.x = p.facing * 280;
      b.play('blast_spin');
      return true;
    }
    popBlast(b) { this.puff(b.x, b.y); b.destroy(); }
    blastHit(b, e) {
      if (!e.alive || !e.awake) return;
      this.popBlast(b);
      e.hit();
      if (!(e instanceof ENEMIES.Vampire)) { SOUND.sfx('kick'); this.addScore(200, e.x, e.y - 10); }
    }

    // ------------------------------------------------------------ moving things
    updateLifts(dt) {
      this.lifts.getChildren().forEach(l => {
        l.t += dt;
        const half = l.cfg.range / 2, k = l.cfg.speed / half;
        const v = half * k * Math.cos(l.t * k);
        if (l.cfg.axis === 'x') l.body.velocity.x = v; else l.body.velocity.y = v;
      });
    }
    updateFirebars(dt) {
      const p = this.player;
      this.firebars.forEach(f => {
        f.angle += f.speed * dt;
        f.balls.forEach((ball, i) => {
          ball.x = f.cx + Math.cos(f.angle) * i * 8;
          ball.y = f.cy + Math.sin(f.angle) * i * 8;
          if (!p.dead && !p.locked && p.star <= 0) {
            const b = p.body;
            const nx = Phaser.Math.Clamp(ball.x, b.left, b.right), ny = Phaser.Math.Clamp(ball.y, b.top, b.bottom);
            if ((nx - ball.x) ** 2 + (ny - ball.y) ** 2 < 9) this.hurtPlayer();
          }
        });
      });
    }

    // ------------------------------------------------------------ effects
    debris(key, x, y, n, brick) {
      for (let i = 0; i < n; i++) {
        const d = this.physics.add.image(x, y, key, 0).setDepth(30);
        if (brick) d.setDisplaySize(8, 8);
        d.body.setVelocity((i % 2 ? 1 : -1) * (40 + Math.random() * 50), -180 - (i < 2 ? 80 : 0) - Math.random() * 60);
        d.body.setAngularVelocity((i % 2 ? 1 : -1) * 400);
        this.time.delayedCall(1200, () => d.destroy());
      }
    }
    puff(x, y) {
      const s = this.add.image(x, y, 'px_white').setDepth(20).setAlpha(0.8);
      this.tweens.add({ targets: s, y: y + 6, alpha: 0, scale: 2, duration: 300, onComplete: () => s.destroy() });
    }

    // ------------------------------------------------------------ dying
    playerDied(pit) {
      const p = this.player;
      if (p.dead) return;
      SOUND.stopMusic();
      SOUND.setSpeed(1);
      SOUND.music('death', { restart: true });
      if (pit) { p.dead = true; p.body.enable = false; p.setVisible(false); }
      else p.die();
      GAME.form = 'pajamas';
      this.time.delayedCall(3200, () => {
        GAME.lives--;
        if (GAME.lives <= 0) this.scene.start('GameOver');
        else this.scene.start('Intro', { levelIndex: this.levelIndex, fromCheckpoint: GAME.checkpoint === this.levelIndex });
      });
    }

    // ------------------------------------------------------------ the end of a level
    startGoal() {
      const p = this.player;
      this.finished = true;
      p.locked = true;
      p.star = 0; p.clearTint(); p.setAlpha(1); p.invuln = 0;
      SOUND.stopMusic(); SOUND.setSpeed(1);
      SOUND.sfx('slide');
      const h = p.y;
      const pts = h < 56 ? 5000 : h < 88 ? 2000 : h < 120 ? 800 : h < 152 ? 400 : 100;
      if (pts === 5000) this.oneUp(p.x + 16, p.y - 10);
      this.addScore(pts, p.x + 16, p.y);
      p.body.setVelocity(0, 0);
      p.body.enable = false;
      p.x = this.pole.x - 6;
      p.setFlipX(false);
      p.setPose('jump');
      const bottomY = this.pole.bottom - 12;
      const dur = Math.max(300, (bottomY - p.y) * 8);
      this.tweens.add({ targets: this.flag, y: this.pole.bottom - 12, duration: dur });
      this.tweens.add({
        targets: p, y: bottomY, duration: dur, onComplete: () => {
          this.time.delayedCall(250, () => {
            p.setFlipX(true);
            this.tweens.add({
              targets: p, x: this.pole.x + 10, y: 12 * TS - 12, duration: 300, onComplete: () => {
                p.setFlipX(false);
                SOUND.music('clear', { restart: true });
                this.walkTo(this.houseDoorX, () => this.knockOnDoor());
              },
            });
          });
        },
      });
    }

    walkTo(x, done) {
      const p = this.player;
      const dist = Math.abs(x - p.x);
      let t = 0;
      const ev = this.time.addEvent({ delay: 90, loop: true, callback: () => { t++; p.setPose(['walk1', 'walk2', 'walk3', 'walk2'][t % 4]); } });
      p.setFlipX(x < p.x);
      this.tweens.add({ targets: p, x, duration: dist * 14, onComplete: () => { ev.remove(); p.setPose('idle'); done(); } });
    }

    knockOnDoor() {
      const p = this.player;
      p.setPose('knock');
      SOUND.sfx('knock');
      const say = (txt, delay, tint) => this.time.delayedCall(delay, () => {
        const t = this.add.bitmapText(p.x, p.y - 30, 'font', txt).setOrigin(0.5).setDepth(70).setTint(tint || 0xffffff);
        this.tweens.add({ targets: t, y: t.y - 8, duration: 300 });
        this.time.delayedCall(1300, () => t.destroy());
      });
      say('KNOCK KNOCK!', 0, 0xffd23f);
      this.time.delayedCall(700, () => { p.setPose('idle'); });
      say('WHO LIVES HERE?', 1500);
      this.time.delayedCall(2900, () => {
        this.tweens.add({ targets: p, alpha: 0, duration: 400 });
        this.tallyTime();
      });
    }

    tallyTime() {
      const ev = this.time.addEvent({
        delay: 16, loop: true, callback: () => {
          if (this.timeLeft <= 0) {
            ev.remove();
            this.timeLeft = 0;
            this.time.delayedCall(1200, () => this.nextLevel());
            return;
          }
          const step = Math.min(5, this.timeLeft);
          this.timeLeft -= step; GAME.score += step * 50;
          SOUND.sfx('tick');
        },
      });
    }

    nextLevel() {
      GAME.checkpoint = -1;
      saveBest();
      const next = this.levelIndex + 1;
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.time.delayedCall(320, () => {
        if (next >= LEVELS.list.length) this.scene.start('Ending');
        else { GAME.unlocked = Math.max(GAME.unlocked || 0, next); saveBest(); this.scene.start('Intro', { levelIndex: next }); }
      });
    }

    // ------------------------------------------------------------ boss
    startBoss() {
      this.bossActive = true;
      const B = this.def.boss;
      const left = (B.x - 11) * TS, right = left + 25 * TS;
      this.cameras.main.stopFollow();
      this.tweens.add({ targets: this.cameras.main, scrollX: left, duration: 600 });
      this.cameras.main.setBounds(left, 0, 25 * TS, 224);
      // Close the arena behind the player.
      for (let y = 9; y <= 11; y++) { const t = this.layer.putTileAt(T.HARD, B.x - 11, y); t.setCollision(true, true, true, true); }
      SOUND.sfx('bossHit');
      this.boss = new ENEMIES.Vampire(this, B.x * TS, (B.y + 1) * TS - 16, { left: left + 16, right: right - 16 });
      this.spawnEnemy(this.boss);
      this.boss.wake();
      const t = this.add.bitmapText(left + 200, 60, 'font', 'COUNT SNOOZULA!').setOrigin(0.5).setScale(2).setDepth(80).setTint(0xff5a6a);
      this.tweens.add({ targets: t, alpha: 0, delay: 1800, duration: 500, onComplete: () => t.destroy() });
    }

    bossDefeated(v) {
      this.finished = true;
      const p = this.player;
      SOUND.stopMusic();
      v.body.setVelocity(0, 0);
      v.setFrame(1);
      this.allEnemies.forEach(e => { if (e !== v && e.alive) e.hit(); });
      const z = this.add.bitmapText(v.x + 10, v.y - 24, 'font', 'Z z z').setDepth(80);
      this.tweens.add({ targets: z, y: z.y - 10, alpha: 0.3, yoyo: true, repeat: -1, duration: 900 });
      p.locked = true; p.star = 0; p.clearTint(); p.invuln = 0; p.setAlpha(1);
      this.time.delayedCall(1400, () => {
        p.body.enable = false;
        p.y = 12 * TS - 12; // stand on the arena floor
        this.walkTo(v.x - 22, () => {
          const C = ART.CHARACTERS[GAME.character];
          const his = GAME.character === 'mama' ? 'HER' : 'HIS';
          // Tuck the cape over the Count's cold toes, just like in the book.
          const cape = this.add.image(v.x, v.y + 12, 'cape', 0).setDepth(7).setAlpha(0);
          this.tweens.add({ targets: cape, alpha: 1, duration: 600 });
          SOUND.sfx('confirm');
          const lines = [C.name + ' TUCKS ' + his + ' CAPE', "OVER THE COUNT'S COLD TOES.", '', 'TUCK, TUCK.', 'GOODNIGHT, COUNT SNOOZULA!'];
          const cx = this.cameras.main.scrollX + 200;
          lines.forEach((l, i) => this.time.delayedCall(600 + i * 500, () => this.add.bitmapText(cx, 50 + i * 12, 'font', l).setOrigin(0.5).setDepth(80).setTint(i >= 3 ? 0xffd23f : 0xffffff)));
          this.time.delayedCall(1500, () => SOUND.music('clear', { restart: true }));
          this.addScore(5000);
          this.time.delayedCall(6000, () => this.nextLevel());
        });
      });
    }
  }

  window.GameScene = GameScene;
})();
