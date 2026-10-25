// World 1 level layouts, built with a small level-building script.
// The grid is 14 tiles tall (16px tiles). Row 12 is the top of the ground.
(function () {
  'use strict';

  const T = { GROUND_TOP: 0, GROUND: 1, BRICK: 2, BLOCK: 3, USED: 4, HARD: 5, PIPE_TL: 6, PIPE_TR: 7, PIPE_L: 8, PIPE_R: 9, PLANK: 10, GOO: 11 };
  const ROWS = 14, GROUND_ROW = 12;

  class Level {
    constructor(opts) {
      Object.assign(this, { theme: 'street', music: 'street', time: 400, ceiling: false }, opts);
      this.grid = [];
      for (let y = 0; y < ROWS; y++) this.grid.push(new Array(this.width).fill(-1));
      this.contents = {};   // "x,y" -> { kind, hidden, count }
      this.enemies = [];    // { type, x, y }
      this.items = [];      // floating candy etc.
      this.decor = [];      // { key, x, y, depth }
      this.lifts = [];      // moving platforms
      this.firebars = [];
      this.pipes = [];      // { x, top } (used for zombie hands)
      this.start = { x: 3, y: GROUND_ROW - 1 };
      this.checkpointX = null;
      this.goalX = null;
      this.boss = null;
    }
    set(x, y, t) { if (x >= 0 && x < this.width && y >= 0 && y < ROWS) this.grid[y][x] = t; }
    get(x, y) { return (x >= 0 && x < this.width && y >= 0 && y < ROWS) ? this.grid[y][x] : -1; }
    // Solid ground from x0 to x1 inclusive, rows `top`..13.
    ground(x0, x1, top) {
      top = top === undefined ? GROUND_ROW : top;
      for (let x = x0; x <= x1; x++) for (let y = top; y < ROWS; y++) this.set(x, y, T.GROUND);
      return this;
    }
    // Horizontal run of blocks: B brick, ? candy, P power-up, S star brick, M multi-candy brick,
    // L 1-up block, H hidden 1-up, X hard block, U used block, = plank, ' ' nothing.
    blocks(x, y, str) {
      [...str].forEach((ch, i) => {
        const bx = x + i;
        switch (ch) {
          case 'B': this.set(bx, y, T.BRICK); break;
          case '?': this.set(bx, y, T.BLOCK); this.contents[bx + ',' + y] = { kind: 'candy' }; break;
          case 'P': this.set(bx, y, T.BLOCK); this.contents[bx + ',' + y] = { kind: 'power' }; break;
          case 'L': this.set(bx, y, T.BLOCK); this.contents[bx + ',' + y] = { kind: 'oneup' }; break;
          case 'S': this.set(bx, y, T.BRICK); this.contents[bx + ',' + y] = { kind: 'star' }; break;
          case 'M': this.set(bx, y, T.BRICK); this.contents[bx + ',' + y] = { kind: 'multi', count: 8 }; break;
          case 'H': this.contents[bx + ',' + y] = { kind: 'oneup', hidden: true }; break;
          case 'X': this.set(bx, y, T.HARD); break;
          case 'U': this.set(bx, y, T.USED); break;
          case '=': this.set(bx, y, T.PLANK); break;
          case 'G': this.set(bx, y, T.GOO); break;
          default: break;
        }
      });
      return this;
    }
    pipe(x, h, hand) {
      const top = GROUND_ROW - h;
      this.set(x, top, T.PIPE_TL); this.set(x + 1, top, T.PIPE_TR);
      for (let y = top + 1; y < GROUND_ROW; y++) { this.set(x, y, T.PIPE_L); this.set(x + 1, y, T.PIPE_R); }
      this.pipes.push({ x, top });
      if (hand) this.enemies.push({ type: 'hand', x: x + 0.5, y: top });
      return this;
    }
    // Staircase of hard blocks. dir 1 goes up to the right, -1 goes down to the right.
    stairs(x, n, dir, baseRow) {
      const base = baseRow === undefined ? GROUND_ROW - 1 : baseRow;
      for (let i = 0; i < n; i++) {
        const h = dir > 0 ? i + 1 : n - i;
        for (let k = 0; k < h; k++) this.set(x + i, base - k, T.HARD);
      }
      return this;
    }
    column(x, top, bottom, t) { for (let y = top; y <= bottom; y++) this.set(x, y, t === undefined ? T.HARD : t); return this; }
    fill(x0, y0, x1, y1, t) { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) this.set(x, y, t); return this; }
    enemy(type, x, y) { this.enemies.push({ type, x, y: y === undefined ? GROUND_ROW - 1 : y }); return this; }
    candy(x, y, n) { for (let i = 0; i < (n || 1); i++) this.items.push({ type: 'candy', x: x + i, y }); return this; }
    arc(x, y, n) { // candy in a jump arc
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), dy = Math.round(4 * t * (1 - t) * 3);
        this.items.push({ type: 'candy', x: x + i, y: y - dy });
      }
      return this;
    }
    decorAt(key, x, y, depth) { this.decor.push({ key, x, y, depth: depth || 0 }); return this; }
    lift(x, y, w, axis, range, speed) { this.lifts.push({ x, y, w, axis, range, speed }); return this; }
    firebar(x, y, len, speed) { this.firebars.push({ x, y, len, speed }); return this; }
    begin(x) { this.start = { x, y: GROUND_ROW - 1 }; return this; }
    checkpoint(x) { this.checkpointX = x; return this; }
    goal(x, spooky) { this.goalX = x; this.goalSpooky = !!spooky; this.set(x, GROUND_ROW - 1, T.HARD); return this; }
    // Fix up ground tiles so grassy tops appear wherever ground meets air.
    finish() {
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < this.width; x++) {
        if (this.grid[y][x] === T.GROUND && (y === 0 || this.grid[y - 1][x] === -1 || this.grid[y - 1][x] === T.GOO)) {
          if (!this.ceiling || y > 2) this.grid[y][x] = T.GROUND_TOP;
        }
      }
      return this;
    }
  }

  // Scatter some scenery along the ground.
  function sceneryStreet(L, from, to) {
    for (let x = from; x < to; x += 7) {
      const k = (x * 7) % 5;
      if (L.get(x, GROUND_ROW) === -1 || L.get(x, GROUND_ROW - 1) !== -1) continue;
      if (k === 0) L.decorAt('decor_bush', x, GROUND_ROW, -1);
      else if (k === 1) L.decorAt('decor_grave', x, GROUND_ROW, -1);
      else if (k === 2) L.decorAt('decor_lantern', x, GROUND_ROW, -1);
      else if (k === 3) L.decorAt('decor_fence', x, GROUND_ROW, -1);
      else L.decorAt('decor_lamp', x, GROUND_ROW, -1);
    }
  }

  // ---------------------------------------------------------------- 1-1 SUPERHEROVILLE STREET
  // Teaching level: jump, stomp, power-up, pipes, pits, shells, stairs, flagpole.
  function level1() {
    const L = new Level({ width: 212, name: 'SUPERHEROVILLE STREET', theme: 'street', music: 'street', bg: 'street' });
    L.ground(0, 68).ground(71, 86).ground(90, 152).ground(155, 211);
    L.begin(3);
    // Lesson 1: a block up high to make you jump. Lesson 2: a skeleton walks at you.
    L.blocks(16, 8, '?');
    L.blocks(20, 8, 'BPB?B').blocks(22, 4, '?');
    L.enemy('skelly', 23);
    // Pipes of growing height with skeletons between them.
    L.pipe(28, 2).pipe(38, 3).pipe(46, 4).pipe(57, 4);
    L.enemy('skelly', 41).enemy('skelly', 51).enemy('skelly', 53);
    L.blocks(64, 7, 'H');
    L.arc(66, 9, 7);
    // First pit, then bricks overhead with a candy block.
    L.blocks(77, 8, 'B?B');
    L.blocks(80, 4, 'BBBBBBBB');
    L.enemy('skelly', 81, 3).enemy('skelly', 83, 3);
    L.blocks(91, 4, 'BBB?').blocks(94, 8, 'M');
    L.checkpoint(100);
    L.blocks(100, 8, 'BS');
    // A pumpkin to teach the shell kick.
    L.blocks(106, 8, '?').blocks(109, 8, '?').blocks(109, 4, 'P').blocks(112, 8, '?');
    L.enemy('jack', 108).enemy('skelly', 114).enemy('skelly', 116);
    L.blocks(118, 8, 'B').blocks(121, 4, 'BBB');
    L.enemy('bat', 124, 6);
    L.blocks(128, 4, 'B??B').blocks(129, 8, 'BB');
    L.enemy('skelly', 130).enemy('skelly', 132);
    // Two little pyramids, the second with a pit in the middle.
    L.stairs(134, 4, 1).stairs(140, 4, -1);
    L.stairs(147, 5, 1).column(152, 7, 11); // flat 2-block top before the pit
    L.stairs(155, 4, -1);
    L.pipe(163, 2);
    L.blocks(168, 8, 'BB?B');
    L.enemy('skelly', 172).enemy('jack', 175);
    L.pipe(179, 2);
    // The big staircase up to the flagpole.
    L.stairs(181, 8, 1).column(189, 4, 11);
    L.goal(198, false);
    sceneryStreet(L, 2, 196);
    return L.finish();
  }

  // ---------------------------------------------------------------- 1-2 CREEPY CRYPT
  // Underground: low ceiling, ghosts, zombie hands in pipes, bats, a secret candy room above.
  function level2() {
    const L = new Level({ width: 196, name: 'CREEPY CRYPT', theme: 'crypt', music: 'crypt', bg: 'crypt', ceiling: true, time: 400 });
    L.ground(0, 79).ground(83, 120).ground(124, 195);
    L.fill(6, 1, 150, 1, T.BRICK); // ceiling
    L.column(0, 1, 11, T.BRICK);
    L.begin(3);
    L.blocks(10, 8, '?????');
    L.enemy('skelly', 16).enemy('skelly', 18);
    L.stairs(20, 4, 1).column(24, 8, 11).column(25, 8, 11);
    L.candy(20, 6, 6);
    L.enemy('ghost', 30, 6);
    L.blocks(29, 8, 'B').blocks(30, 5, 'BMB').blocks(34, 8, 'BBPB');
    L.fill(38, 4, 40, 8, T.BRICK).blocks(39, 9, 'B');
    L.candy(42, 5, 4);
    L.enemy('jack', 44).enemy('skelly', 47);
    L.fill(46, 6, 52, 6, T.BRICK).blocks(46, 2, '').candy(46, 5, 7);
    L.pipe(56, 3, true).pipe(62, 4, true).pipe(68, 2, true);
    L.enemy('bat', 60, 5).enemy('bat', 66, 4);
    L.checkpoint(75);
    L.blocks(73, 8, 'BBSB').blocks(76, 4, 'BBBBBB');
    L.enemy('mummy', 86).enemy('mummy', 92);
    L.fill(84, 9, 86, 11, T.BRICK).fill(94, 8, 96, 11, T.BRICK);
    L.blocks(98, 5, 'BB?BB');
    L.enemy('ghost', 102, 4).enemy('skelly', 104).enemy('skelly', 106);
    L.blocks(108, 8, 'BBBBB').blocks(110, 4, 'L');
    L.pipe(114, 3, true);
    L.fill(126, 8, 140, 8, T.BRICK).candy(126, 7, 15);
    L.enemy('jack', 128, 7).enemy('skelly', 135, 7);
    L.enemy('bat', 132, 4);
    L.enemy('wolf', 142).enemy('skelly', 146);
    L.pipe(150, 2, true);
    L.stairs(160, 7, 1).column(167, 5, 11);
    L.goal(176, true);
    for (let x = 4; x < 172; x += 9) if (L.get(x, GROUND_ROW) !== -1 && L.get(x, GROUND_ROW - 1) === -1) L.decorAt('decor_grave', x, GROUND_ROW, -1);
    return L.finish();
  }

  // ---------------------------------------------------------------- 1-3 ROOFTOP RUN
  // Jump across rooftops, ride moving platforms, dodge hopping werewolves and bats.
  function level3() {
    const L = new Level({ width: 204, name: 'ROOFTOP RUN', theme: 'roof', music: 'roof', bg: 'roof', time: 350 });
    const roof = (x0, x1, top) => L.ground(x0, x1, top);
    roof(0, 14, 12);
    L.begin(2);
    roof(17, 23, 10).blocks(19, 6, "?P?");
    roof(26, 30, 8);
    L.lift(34.5, 8, 4, 'x', 112, 40);
    roof(42, 52, 9).enemy('wolf', 48, 8);
    L.blocks(44, 5, 'B?B');
    roof(56, 58, 7).arc(53, 7, 5);
    L.lift(60.5, 9, 4, 'y', 48, 30);
    roof(65, 76, 11).enemy('skelly', 70, 10).enemy('jack', 73, 10);
    L.enemy('bat', 74, 5);
    L.blocks(68, 7, 'BMB');
    L.checkpoint(80);
    roof(79, 90, 10).blocks(82, 6, '=====').enemy('wolf', 87, 9);
    L.candy(82, 5, 5);
    L.lift(95, 10, 4, 'x', 128, 44);
    roof(103, 106, 8);
    L.blocks(104, 4, 'S');
    roof(110, 120, 9).enemy('mummy', 115, 8);
    L.enemy('bat', 118, 4).enemy('bat', 122, 6);
    L.lift(122.5, 7, 3, 'y', 64, 36);
    roof(127, 130, 6);
    roof(134, 146, 10).blocks(137, 6, '?L?').enemy('wolf', 140, 9).enemy('wolf', 144, 9);
    L.lift(150.5, 9, 4, 'x', 112, 44);
    roof(158, 170, 11).enemy('jack', 163, 10).enemy('skelly', 166, 10);
    roof(174, 203, 12);
    L.stairs(176, 6, 1).column(182, 6, 11);
    L.goal(190, false);
    return L.finish();
  }

  // ---------------------------------------------------------------- 1-4 COUNT SNOOZULA'S CASTLE
  // Castle with bubbling potion pits and spinning candle bars. Boss: Count Snoozula.
  function level4() {
    const L = new Level({ width: 168, name: "COUNT SNOOZULA'S CASTLE", theme: 'castle', music: 'castle', bg: 'castle', ceiling: true, time: 400 });
    L.ground(0, 15, 9).ground(16, 26).ground(30, 50).ground(54, 75, 10).ground(80, 110).ground(114, 167);
    for (let x = 27; x <= 29; x++) L.set(x, 13, T.GOO);
    for (let x = 51; x <= 53; x++) L.set(x, 13, T.GOO);
    for (let x = 76; x <= 79; x++) L.set(x, 13, T.GOO);
    for (let x = 111; x <= 113; x++) L.set(x, 13, T.GOO);
    L.fill(0, 1, 167, 2, T.BRICK);
    L.fill(16, 3, 26, 5, T.BRICK);
    L.begin(3);
    L.start.y = 8;
    L.blocks(20, 8, 'P');
    L.firebar(36, 8, 5, 1.6).blocks(36, 8, 'U');
    L.enemy('skelly', 40).enemy('skelly', 44);
    L.firebar(46, 6, 4, -1.9).blocks(46, 6, 'U');
    L.fill(56, 3, 70, 5, T.BRICK);
    L.firebar(62, 9, 5, 2.0).blocks(62, 9, 'U');
    L.enemy('mummy', 66, 9);
    L.checkpoint(82);
    L.blocks(86, 8, '?P?');
    L.enemy('wolf', 92).enemy('ghost', 98, 5);
    L.firebar(104, 8, 5, -1.7).blocks(104, 8, 'U');
    // Boss arena
    L.fill(114, 3, 167, 4, T.BRICK);
    L.column(164, 5, 11, T.HARD); // back wall of the boss room
    L.boss = { type: 'vampire', x: 150, y: 9, arenaLeft: 118, arenaRight: 162 };
    L.goalX = null;
    return L.finish();
  }

  window.LEVELS = { T, ROWS, GROUND_ROW, list: [level1, level2, level3, level4], names: ['1-1', '1-2', '1-3', '1-4'] };
})();
