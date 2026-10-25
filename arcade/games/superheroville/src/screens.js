// Boot, title, character select, level intro, game over and ending screens.
(function () {
  'use strict';
  const TS = 16;

  function shadowText(scene, x, y, txt, opts) {
    opts = opts || {};
    const scale = opts.scale || 1;
    const sh = scene.add.bitmapText(x + scale, y + scale, 'font', txt).setOrigin(opts.ox === undefined ? 0.5 : opts.ox, 0.5).setScale(scale).setTint(0x000000).setDepth(opts.depth || 10);
    const t = scene.add.bitmapText(x, y, 'font', txt).setOrigin(opts.ox === undefined ? 0.5 : opts.ox, 0.5).setScale(scale).setDepth((opts.depth || 10) + 1);
    if (opts.tint) t.setTint(opts.tint);
    return { t, sh, setText(s) { t.setText(s); sh.setText(s); }, setVisible(v) { t.setVisible(v); sh.setVisible(v); } };
  }

  // A scrolling night-time street used behind the menus.
  function menuBackdrop(scene) {
    scene.add.image(0, 0, 'sky_street').setOrigin(0).setDisplaySize(400, 224);
    scene.add.image(0, 0, 'stars').setOrigin(0);
    scene.add.image(372, 40, 'moon');
    const far = scene.add.tileSprite(0, 92, 400, 120, 'houses_far').setOrigin(0);
    const trees = scene.add.tileSprite(0, 134, 400, 90, 'trees').setOrigin(0);
    const near = scene.add.tileSprite(0, 114, 400, 110, 'houses_near').setOrigin(0).setTint(0x9a8ac8).setAlpha(0.85);
    const ground = scene.add.tileSprite(0, 192, 400, 32, 'ground_strip').setOrigin(0);
    scene.events.on('update', (t, d) => {
      far.tilePositionX += d * 0.004; trees.tilePositionX += d * 0.009; near.tilePositionX += d * 0.016; ground.tilePositionX += d * 0.035;
    });
  }

  // ---------------------------------------------------------------- BOOT
  class BootScene extends Phaser.Scene {
    constructor() { super('Boot'); }
    create() {
      FONT.register(this);
      ART.registerAll(this);
      // A few extra textures built from the tile art.
      const tiles = this.textures.get('tiles_street').getSourceImage();
      const strip = document.createElement('canvas'); strip.width = 32; strip.height = 32;
      const sctx = strip.getContext('2d');
      sctx.drawImage(tiles, 0, 0, 16, 16, 0, 0, 16, 16); sctx.drawImage(tiles, 0, 0, 16, 16, 16, 0, 16, 16);
      sctx.drawImage(tiles, 16, 0, 16, 16, 0, 16, 16, 16); sctx.drawImage(tiles, 16, 0, 16, 16, 16, 16, 16, 16);
      this.textures.addCanvas('ground_strip', strip);
      const plank = document.createElement('canvas'); plank.width = 16; plank.height = 6;
      plank.getContext('2d').drawImage(tiles, 160, 0, 16, 6, 0, 0, 16, 6);
      this.textures.addCanvas('plank', plank);
      const g = this.add.graphics();
      g.fillStyle(0xff7a1a); g.fillCircle(4, 4, 4); g.fillStyle(0xffd23f); g.fillCircle(4, 4, 2);
      g.generateTexture('fire', 8, 8); g.destroy();

      this.anims.create({ key: 'block_shimmer', frames: this.anims.generateFrameNumbers('block_anim', { frames: [0, 0, 0, 1, 2, 1] }), frameRate: 7, repeat: -1 });
      this.anims.create({ key: 'candy_spin', frames: this.anims.generateFrameNumbers('candy', { frames: [0, 1, 2, 1] }), frameRate: 8, repeat: -1 });
      this.anims.create({ key: 'blast_spin', frames: this.anims.generateFrameNumbers('blast', { frames: [0, 1] }), frameRate: 16, repeat: -1 });
      this.anims.create({ key: 'skelly_walk', frames: this.anims.generateFrameNumbers('skelly', { frames: [0, 1] }), frameRate: 5, repeat: -1 });
      ['sonny', 'dada', 'mama'].forEach(k => ['pajamas', 'hero', 'rocket'].forEach(f => {
        this.anims.create({ key: `${k}_${f}_walk`, frames: this.anims.generateFrameNumbers(`${k}_${f}`, { frames: [1, 2, 3, 2] }), frameRate: 9, repeat: -1 });
      }));
      SOUND.init();
      const start = new URLSearchParams(location.search).get('scene');
      if (start === 'game') { // quick start for automated tests: ?scene=game&level=0&char=sonny
        const q = new URLSearchParams(location.search);
        newGame(q.get('char') || 'sonny');
        if (q.get('form')) GAME.form = q.get('form');
        this.scene.start('Game', { levelIndex: +(q.get('level') || 0) });
      } else this.scene.start('Title');
    }
  }

  // ---------------------------------------------------------------- TITLE
  class TitleScene extends Phaser.Scene {
    constructor() { super('Title'); }
    create() {
      this.ctl = new Controls(this);
      menuBackdrop(this);
      // Logo
      shadowText(this, 200, 38, 'SUPERHEROVILLE', { scale: 3, tint: 0xffd23f, depth: 20 });
      shadowText(this, 200, 64, "SONNY'S HALLOWEEN ADVENTURE", { tint: 0xffffff, depth: 20 });
      // The family, and a skeleton strolling past.
      const fam = [['dada', 150], ['sonny', 200], ['mama', 250]];
      fam.forEach(([k, x], i) => {
        const s = this.add.sprite(x, 192 - 24, `${k}_hero`, 0).setScale(2).setDepth(15);
        this.tweens.add({ targets: s, y: s.y - 6, duration: 420, yoyo: true, repeat: -1, delay: i * 140, ease: 'Sine.easeInOut' });
      });
      const sk = this.add.sprite(430, 192 - 8, 'skelly', 0).play('skelly_walk').setDepth(15);
      this.tweens.add({ targets: sk, x: -40, duration: 14000, repeat: -1 });
      const bat = this.add.sprite(-20, 90, 'bat', 0).setDepth(15);
      this.tweens.add({ targets: bat, x: 440, duration: 9000, repeat: -1, delay: 1500 });
      this.tweens.add({ targets: bat, y: 110, duration: 600, yoyo: true, repeat: -1 });
      this.time.addEvent({ delay: 120, loop: true, callback: () => bat.setFrame((bat.frame.name + 1) % 2) });

      this.press = shadowText(this, 200, 110, window.IS_TOUCH ? 'TAP A TO START' : 'PRESS START', { tint: 0xffffff, depth: 20 });
      this.time.addEvent({ delay: 500, loop: true, callback: () => this.press.setVisible(!this.press.t.visible) });
      shadowText(this, 200, 128, window.IS_TOUCH ? 'A JUMP   B RUN   SLIDE TO MOVE' : 'ARROWS MOVE   SPACE JUMP   SHIFT RUN', { tint: 0xb8b8d8, depth: 20 });
      shadowText(this, 200, 212, 'HI-SCORE ' + String(GAME.best || 0).padStart(6, '0'), { tint: 0xffd23f, depth: 20 });
      if (!window.IS_TOUCH) shadowText(this, 394, 218, 'ESC: ARCADE', { ox: 1, tint: 0x8a8aaa, depth: 20 });
      this.musicStarted = false;
      this.cameras.main.fadeIn(300);
    }
    update() {
      this.ctl.update();
      if (!this.musicStarted) { SOUND.init(); SOUND.music('title'); this.musicStarted = !!SOUND.playing; }
      if (this.ctl.pressed('back')) { exitToArcade(); return; }
      if (this.ctl.pressed('confirm')) { SOUND.init(); SOUND.sfx('confirm'); this.scene.start('Select'); }
    }
  }

  // ---------------------------------------------------------------- CHARACTER SELECT
  const PICKS = [
    { key: 'sonny', line1: 'JUST RIGHT!', line2: 'GREAT AT EVERYTHING' },
    { key: 'dada', line1: 'SUPER SPEEDY', line2: 'RUNS THE FASTEST' },
    { key: 'mama', line1: 'FLOATY JUMP', line2: 'HOLD JUMP TO HOVER' },
  ];
  class SelectScene extends Phaser.Scene {
    constructor() { super('Select'); }
    create() {
      this.ctl = new Controls(this);
      menuBackdrop(this);
      this.add.rectangle(0, 0, 400, 224, 0x0a0618, 0.45).setOrigin(0);
      shadowText(this, 200, 22, "WHO'S PLAYING?", { scale: 2, tint: 0xffd23f, depth: 20 });
      this.index = Math.max(0, PICKS.findIndex(p => p.key === GAME.character));
      this.sprites = PICKS.map((p, i) => {
        const x = 80 + i * 120;
        const s = this.add.sprite(x, 104, `${p.key}_hero`, 0).setScale(3).setDepth(15);
        shadowText(this, x, 150, ART.CHARACTERS[p.key].name, { tint: 0xffffff, depth: 20 });
        shadowText(this, x, 164, p.line1, { tint: 0xffd23f, depth: 20 });
        shadowText(this, x, 176, p.line2, { tint: 0xb8b8d8, depth: 20 });
        return s;
      });
      this.cursor = this.add.image(0, 60, 'bigstar').setScale(0.4).setDepth(16);
      this.levelPick = 0;
      this.levelText = shadowText(this, 200, 198, '', { tint: 0xffffff, depth: 20 });
      this.refresh();
      this.cameras.main.fadeIn(200);
    }
    refresh() {
      this.sprites.forEach((s, i) => {
        const on = i === this.index;
        s.setAlpha(on ? 1 : 0.55);
        if (on) s.play(`${PICKS[i].key}_hero_walk`, true); else { s.stop(); s.setFrame(0); }
      });
      this.cursor.x = this.sprites[this.index].x;
      const un = GAME.unlocked || 0;
      this.levelText.setText(un > 0 ? 'START AT: WORLD ' + LEVELS.names[this.levelPick] + '  (UP/DOWN)' : (window.IS_TOUCH ? 'TAP A TO START!' : 'PRESS JUMP TO START!'));
    }
    update(t) {
      this.ctl.update();
      this.cursor.angle = Math.sin(t / 300) * 15;
      if (this.ctl.pressed('back')) { this.scene.start('Title'); return; }
      if (this.ctl.pressed('left')) { this.index = (this.index + 2) % 3; SOUND.sfx('select'); this.refresh(); }
      if (this.ctl.pressed('right')) { this.index = (this.index + 1) % 3; SOUND.sfx('select'); this.refresh(); }
      const un = GAME.unlocked || 0;
      if (un > 0 && this.ctl.pressed('down')) { this.levelPick = (this.levelPick + 1) % (un + 1); SOUND.sfx('select'); this.refresh(); }
      if (un > 0 && this.ctl.pressed('up') && !this.ctl.held('jump')) { this.levelPick = (this.levelPick + un) % (un + 1); SOUND.sfx('select'); this.refresh(); }
      if (this.ctl.pressed('confirm') && !this.ctl.pressed('up')) {
        SOUND.sfx('confirm');
        newGame(PICKS[this.index].key);
        this.scene.start('Intro', { levelIndex: this.levelPick });
      }
    }
  }

  // ---------------------------------------------------------------- LEVEL INTRO
  class IntroScene extends Phaser.Scene {
    constructor() { super('Intro'); }
    init(data) { this.levelIndex = data.levelIndex || 0; this.fromCheckpoint = !!data.fromCheckpoint; }
    create() {
      SOUND.stopMusic();
      this.cameras.main.setBackgroundColor('#000000');
      const def = LEVELS.list[this.levelIndex]();
      shadowText(this, 200, 70, 'WORLD ' + LEVELS.names[this.levelIndex], { scale: 2, tint: 0xffffff });
      shadowText(this, 200, 94, def.name, { tint: 0xffd23f });
      this.add.sprite(184, 132, `${GAME.character}_${GAME.form}`, 0).setScale(2);
      shadowText(this, 214, 134, 'x ' + GAME.lives, { ox: 0 });
      shadowText(this, 200, 190, 'SCORE ' + String(GAME.score).padStart(6, '0'), { tint: 0xb8b8d8 });
      this.time.delayedCall(2200, () => this.scene.start('Game', { levelIndex: this.levelIndex, fromCheckpoint: this.fromCheckpoint }));
    }
  }

  // ---------------------------------------------------------------- GAME OVER
  class GameOverScene extends Phaser.Scene {
    constructor() { super('GameOver'); }
    create() {
      this.ctl = new Controls(this);
      this.cameras.main.setBackgroundColor('#000000');
      SOUND.music('gameover', { restart: true });
      saveBest();
      shadowText(this, 200, 80, 'GAME OVER', { scale: 3, tint: 0xff5a6a });
      shadowText(this, 200, 120, 'SCORE ' + String(GAME.score).padStart(6, '0'));
      shadowText(this, 200, 150, 'PRESS JUMP TO TRY AGAIN', { tint: 0xffd23f });
      shadowText(this, 200, 164, 'ESC FOR THE ARCADE', { tint: 0x8a8aaa });
      this.ready = false;
      this.time.delayedCall(1200, () => { this.ready = true; });
    }
    update() {
      this.ctl.update();
      if (this.ctl.pressed('back')) { exitToArcade(); return; }
      if (this.ready && this.ctl.pressed('confirm')) {
        // Try again from the same level with fresh lives (kid-friendly continue).
        const level = Math.max(0, GAME.lastLevel || 0);
        newGame(GAME.character);
        this.scene.start('Intro', { levelIndex: level });
      }
    }
  }

  // ---------------------------------------------------------------- ENDING
  class EndingScene extends Phaser.Scene {
    constructor() { super('Ending'); }
    create() {
      this.ctl = new Controls(this);
      menuBackdrop(this);
      SOUND.music('title', { restart: true });
      saveBest();
      shadowText(this, 200, 30, 'WORLD 1 COMPLETE!', { scale: 2, tint: 0xffd23f, depth: 20 });
      const lines = ['THE MONSTERS OF VILLAINVILLE', 'ARE ALL TUCKED IN.', '', 'GOODNIGHT, SKELETONS.', 'GOODNIGHT, WEREWOLVES.', 'GOODNIGHT, COUNT SNOOZULA.', '', 'AND GOODNIGHT, SONNY.'];
      lines.forEach((l, i) => this.time.delayedCall(400 + i * 450, () => shadowText(this, 200, 58 + i * 11, l, { depth: 20, tint: i === 7 ? 0xffd23f : 0xffffff })));
      [['dada', 160], ['sonny', 200], ['mama', 240]].forEach(([k, x]) => this.add.sprite(x, 192 - 24, `${k}_hero`, 0).setScale(2).setDepth(15));
      shadowText(this, 200, 214, 'SCORE ' + String(GAME.score).padStart(6, '0') + '   MORE WORLDS COMING SOON!', { depth: 20, tint: 0xb8b8d8 });
      this.ready = false;
      this.time.delayedCall(4500, () => { this.ready = true; });
    }
    update() {
      this.ctl.update();
      if (this.ctl.pressed('back')) { exitToArcade(); return; }
      if (this.ready && this.ctl.pressed('confirm')) this.scene.start('Title');
    }
  }

  window.SCREENS = { BootScene, TitleScene, SelectScene, IntroScene, GameOverScene, EndingScene };
})();
