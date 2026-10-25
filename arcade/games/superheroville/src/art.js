// All game art is drawn here in code as pixel art, so the game has no image files.
// Characters are based on the family as drawn in "Sonny and the Two Sides of the Street".
// Each sprite is an ASCII grid: one character per pixel, mapped to colours by a palette.
(function () {
  'use strict';

  const OUTLINE = '#1e1428';

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return { c, ctx };
  }

  // Grid helpers. A grid is an array of arrays of single-char strings ('.' = empty).
  function blank(w, h) {
    const g = [];
    for (let y = 0; y < h; y++) g.push(new Array(w).fill('.'));
    return g;
  }
  function stamp(g, rows, ox, oy) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const gy = oy + y, gx = ox + x;
        if (gy >= 0 && gy < g.length && gx >= 0 && gx < g[0].length) g[gy][gx] = ch;
      }
    });
    return g;
  }
  function fromRows(rows) {
    const w = Math.max(...rows.map(r => r.length));
    return stamp(blank(w, rows.length), rows, 0, 0);
  }
  function flipX(g) { return g.map(r => r.slice().reverse()); }

  // Paint a grid into ctx at (ox, oy). pal maps char -> colour (or function(x,y)->colour).
  function paint(ctx, g, pal, ox, oy, outline) {
    const h = g.length, w = g[0].length;
    if (outline !== false) {
      ctx.fillStyle = typeof outline === 'string' ? outline : OUTLINE;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (g[y][x] !== '.') continue;
        const n = (yy, xx) => yy >= 0 && yy < h && xx >= 0 && xx < w && g[yy][xx] !== '.' && pal[g[yy][xx]] !== null;
        if (n(y - 1, x) || n(y + 1, x) || n(y, x - 1) || n(y, x + 1)) ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = g[y][x];
      if (ch === '.') continue;
      let col = pal[ch];
      if (typeof col === 'function') col = col(x, y);
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }

  // ---------------------------------------------------------------- FAMILY
  // Heads (facing right). Sonny's head is big (toddler proportions).
  const HEADS = {
    sonny: {
      side: [
        '..h.hh.h..',
        '.hhhhhhhh.',
        'hhhhhhhhhh',
        'hhhhhhhhhh',
        'hhhhshhsss',
        'hhhsssswss',
        'hhSssssess',
        'hhhssssesr',
        '.hssssssm.',
        '..sssssss.',
      ],
      front: [
        '..h.hh.h..',
        '.hhhhhhhh.',
        'hhhhhhhhhh',
        'hhshhhhshh',
        'hssssssssh',
        'Sswesswess',
        'Ssessssess',
        'srssmmssrs',
        '.ssmmmmss.',
        '..ssssss..',
      ],
      ox: 3, oy: 1,
    },
    dada: {
      side: [
        '.hhhhhh.',
        'hhhhhhhh',
        'hhhhssss',
        'hhssswss',
        'hSsssess',
        'hbbsssss',
        '.bbbbmbb',
        '..bbbbb.',
      ],
      front: [
        '.hhhhhh.',
        'hhhhhhhh',
        'hssssssh',
        'Swesswes',
        'Sessssess',
        'bbssssbb',
        'bbbmmbbb',
        '.bbbbbb.',
      ],
      ox: 4, oy: 1,
    },
    mama: {
      side: [
        '..hhhhh.',
        '.hhhhhhh',
        'hhhhhsss',
        'hhhssswss',
        'hhhsssess',
        'hhhsssssr',
        'hhhssssm.',
        'hhh.sss..',
      ],
      front: [
        '.hhhhhh.',
        'hhhhhhhh',
        'hhssssshh',
        'hswesswesh',
        'hsessssesh',
        'hrssssssrh',
        'hhssmmsshh',
        'hh.ssss.hh',
      ],
      ox: 4, oy: 1,
    },
  };

  // Bodies. Child bodies start at row 11, adult bodies at row 9. Facing right.
  // u suit, U suit shade, x emblem, y belt, p legs, v boots, s skin (hands), g skirt
  const CHILD = {
    idle: [
      '......uuuu......',
      '.....uuuuuu.....',
      '....Uuuxxuuu....',
      '....Uuuxxuuu....',
      '....Uuuuuuuu....',
      '....suuuuuus....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '.....pp..pp.....',
      '.....pp..pp.....',
      '.....vv..vv.....',
      '....vvv..vvv....',
      '....vvv..vvv....',
    ],
    walk1: [
      '......uuuu......',
      '.....uuuuuu.....',
      '.....uuxxuuu....',
      '....Uuuxxuuus...',
      '...Uuuuuuuu.....',
      '...s.uuuuuu.....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '....pp....pp....',
      '...pp......pp...',
      '..vv.......vv...',
      '.vvv.......vvv..',
      '.vv.........vvv.',
    ],
    walk2: [
      '......uuuu......',
      '.....uuuuuu.....',
      '....Uuuxxuuu....',
      '....Uuuxxuuu....',
      '....Uuuuuuuus...',
      '....suuuuuu.....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '......pppp......',
      '......pp.pp.....',
      '......vv.vv.....',
      '.....vvv.vvv....',
      '.....vvv........',
    ],
    walk3: [
      '......uuuu......',
      '.....uuuuuu.....',
      '....Uuuxxuu.....',
      '...sUuuxxuuu....',
      '....Uuuuuuuuu...',
      '.....uuuuuu.s...',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '.....pp..pp.....',
      '....pp....pp....',
      '...vv......vv...',
      '..vvv......vvv..',
      '..vv........vv..',
    ],
    jump: [
      '......uuuu...ss.',
      '.....uuuuuu.uu..',
      '....Uuuxxuuuu...',
      '...UUuuxxuuu....',
      '..sUuuuuuuu.....',
      '.....uuuuuu.....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '....pp...ppp....',
      '...pp.....ppv...',
      '..vv.......vvv..',
      '.vvv............',
      '.vv.............',
    ],
    skid: [
      '......uuuu......',
      '.....uuuuuu.....',
      '....Uuuxxuuuuus.',
      '...sUuuxxuuu....',
      '....Uuuuuuuu....',
      '.....uuuuuu.....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '.....pp..ppp....',
      '....pp.....pp...',
      '...vv.......vv..',
      '..vvv.......vvv.',
      '..vv.........vvv',
    ],
    dead: [
      '..ss........ss..',
      '..uu.uuuuuu.uu..',
      '...uuuuxxuuuu...',
      '.....uuxxuu.....',
      '.....uuuuuu.....',
      '.....uuuuuu.....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '.....pp..pp.....',
      '.....pp..pp.....',
      '.....vv..vv.....',
      '....vvv..vvv....',
      '....vvv..vvv....',
    ],
    knock: [
      '......uuuu..ss..',
      '.....uuuuuuuu...',
      '....Uuuxxuuu....',
      '....Uuuxxuuu....',
      '....Uuuuuuu.....',
      '....suuuuuu.....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '.....pp..pp.....',
      '.....pp..pp.....',
      '.....vv..vv.....',
      '....vvv..vvv....',
      '....vvv..vvv....',
    ],
  };
  CHILD.glide = CHILD.jump; CHILD.fly = CHILD.jump;

  const ADULT = {
    idle: [
      '......ssss......',
      '.....uuuuuu.....',
      '....uuuuuuuu....',
      '....UuuxxuuU....',
      '....UuuxxuuU....',
      '....Uuuuuuuu....',
      '....Uuuuuuuu....',
      '....suuuuuus....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '.....pp..pp.....',
      '.....pp..pp.....',
      '.....vv..vv.....',
      '.....vv..vv.....',
      '....vvv..vvv....',
    ],
    walk1: [
      '......ssss......',
      '.....uuuuuu.....',
      '....uuuuuuuu....',
      '....UuuxxuuUu...',
      '...UuuuxxuuU.s..',
      '...Uuuuuuuuu....',
      '..s.uuuuuuu.....',
      '.....uuuuuu.....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '....pp....pp....',
      '...pp......pp...',
      '...vv.......vv..',
      '..vv.........vv.',
      '.vvv.........vvv',
    ],
    walk2: [
      '......ssss......',
      '.....uuuuuu.....',
      '....uuuuuuuu....',
      '....UuuxxuuU....',
      '....UuuxxuuUu...',
      '....Uuuuuuuu.s..',
      '....suuuuuuu....',
      '.....uuuuuu.....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '......pppp......',
      '......pp.pp.....',
      '......vv.vv.....',
      '......vv.vv.....',
      '.....vvv.vvv....',
    ],
    walk3: [
      '......ssss......',
      '.....uuuuuu.....',
      '....uuuuuuuu....',
      '...uUuuxxuuU....',
      '..s.UuuxxuuUu...',
      '....Uuuuuuuuu...',
      '.....uuuuuu..s..',
      '.....uuuuuu.....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '.....pp..pp.....',
      '....pp....pp....',
      '....vv....vv....',
      '...vv......vv...',
      '..vvv......vvv..',
    ],
    jump: [
      '......ssss...ss.',
      '.....uuuuuu.uu..',
      '....uuuuuuuuu...',
      '....Uuuxxuuu....',
      '...UUuuxxuuU....',
      '..UUuuuuuuuu....',
      '..s.uuuuuuuu....',
      '.....uuuuuu.....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '....pp...ppp....',
      '...pp.....ppv...',
      '..vv.......vvv..',
      '.vvv............',
      '.vv.............',
    ],
    skid: [
      '......ssss......',
      '.....uuuuuu.....',
      '....uuuuuuuu....',
      '....Uuuxxuuuuus.',
      '...sUuuxxuuU....',
      '....Uuuuuuuu....',
      '....Uuuuuuuu....',
      '.....uuuuuu.....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '.....pp..ppp....',
      '....pp.....pp...',
      '...vv.......vv..',
      '..vv.........vv.',
      '.vvv.........vvv',
    ],
    dead: [
      '.ss...ssss...ss.',
      '.uu.uuuuuuuu.uu.',
      '..uuuuuuuuuuuu..',
      '....uuuxxuuu....',
      '....uuuxxuuu....',
      '....uuuuuuuu....',
      '....uuuuuuuu....',
      '.....uuuuuu.....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '.....pp..pp.....',
      '.....pp..pp.....',
      '.....vv..vv.....',
      '.....vv..vv.....',
      '....vvv..vvv....',
    ],
    knock: [
      '......ssss..ss..',
      '.....uuuuuuuu...',
      '....uuuuuuuu....',
      '....UuuxxuuU....',
      '....UuuxxuuU....',
      '....Uuuuuuu.....',
      '....Uuuuuuu.....',
      '....suuuuuu.....',
      '.....yyyyyy.....',
      '.....pppppp.....',
      '.....pp..pp.....',
      '.....pp..pp.....',
      '.....vv..vv.....',
      '.....vv..vv.....',
      '....vvv..vvv....',
    ],
  };
  ADULT.glide = ADULT.jump; ADULT.fly = ADULT.jump;

  // Mama wears a skirt over the leg rows (rows 9-11 of the adult body).
  const SKIRT = {
    default: ['....gggggggg....', '...gGggggggGg...', '...gggggggggg...'],
    walk1:   ['....gggggggg....', '...gGggggggGgg..', '..ggggggggggggg.'],
    walk3:   ['....gggggggg....', '...gGggggggGg...', '..gggggggggggg..'],
    jump:    ['....gggggggg....', '...gGggggggGgg..', '..ggggggggggggg.'],
  };
  // Mama's long hair falls down her back over the shoulders.
  const MAMA_HAIR_BACK = ['hhh', 'hhh', 'hhh', '.hh', '.hh'];

  // Cape and jetpack are drawn behind the body. [x, y, w, h] rects in frame coordinates
  // relative to the shoulder line (y=0 at the top of the suit).
  const CAPE = {
    idle:  ['..ccc', '.cccc', '.cccC', 'ccccC', 'ccccC', 'cccCC', 'cccC.', 'ccC..'],
    walk:  ['...ccc', '.ccccc', 'cccccC', 'ccccC.', 'cccC..', 'cC....'],
    jump:  ['....cc', '..cccc', 'cccccC', 'ccccCC', 'cccC..', 'cc....'],
    glide: ['....ccc', '.cccccc', 'cccccCC', 'cccCC..', 'cCC....'],
    skid:  ['..ccc', '.cccc', '.cccC', '.ccCC', '..cC.'],
  };
  const JETPACK = ['jjj', 'jJj', 'jJj', 'jjj', 'JJJ'];
  const FLAME = [['.f.', 'fFf', '.F.'], ['fFf', 'fFf', '.F.', '.f.']];

  const CHARACTERS = {
    sonny: {
      name: 'SONNY', body: CHILD, shoulder: 11, child: true,
      hair: '#f2c94c', hairShade: '#c99a2e', skin: '#ffd6b5', skinShade: '#e8a988', blush: '#f28b9b',
      beard: null,
    },
    dada: {
      name: 'DADA', body: ADULT, shoulder: 9, child: false,
      hair: '#c98a4a', hairShade: '#9a6230', skin: '#f6c8a4', skinShade: '#d89a78', blush: '#e88a8a',
      beard: '#b27238',
    },
    mama: {
      name: 'MAMA', body: ADULT, shoulder: 9, child: false, skirt: true,
      hair: '#9a6a44', hairShade: '#74482a', skin: '#ffd8bc', skinShade: '#e8a98a', blush: '#f08a9a',
      beard: null,
    },
  };

  // Outfits. 'pajamas' is the starting form; 'hero' comes from the Hero Cape;
  // 'rocket' from the Rocket Suit.
  const FORMS = {
    pajamas: { u: '#9fd0f0', U: '#79acd6', stripe: '#ffffff', x: null, y: null, p: '#9fd0f0', v: 'skin', g: '#9fd0f0', G: '#79acd6' },
    hero:    { u: '#3d6fe0', U: '#2b51ad', x: '#ffd23f', y: '#ffd23f', p: '#3d6fe0', v: '#e0342f', g: '#e0342f', G: '#a82420', c: '#e0342f', C: '#a82420' },
    rocket:  { u: '#d23a2e', U: '#902020', x: '#7ff0ff', y: '#f2b632', p: '#f2b632', v: '#d23a2e', g: '#d23a2e', G: '#902020', j: '#c8ccd8', J: '#8a90a4', f: '#ffd23f', F: '#ff7a1a' },
  };

  const FRAME_W = 16, FRAME_H = 24;
  const POSES = ['idle', 'walk1', 'walk2', 'walk3', 'jump', 'skid', 'dead', 'knock', 'glide', 'fly'];

  function composeCharacter(key, form, pose) {
    const C = CHARACTERS[key];
    const g = blank(FRAME_W, FRAME_H);
    const sh = C.shoulder;
    // Behind-body layers
    if (form === 'hero' && pose !== 'dead') {
      const cp = pose === 'glide' ? CAPE.glide : pose.startsWith('walk') ? CAPE.walk : (pose === 'jump' || pose === 'fly') ? CAPE.jump : pose === 'skid' ? CAPE.skid : CAPE.idle;
      const cx = pose === 'glide' ? 0 : 1;
      const cy = sh + 1;
      stamp(g, cp, cx, cy);
    }
    if (form === 'rocket' && pose !== 'dead') {
      stamp(g, JETPACK, 2, sh + 1);
      if (pose === 'fly' || pose === 'jump' || pose === 'glide') stamp(g, FLAME[pose === 'fly' ? 1 : 0], 2, sh + 6);
    }
    if (key === 'mama' && pose !== 'dead') stamp(g, MAMA_HAIR_BACK, 3, sh - 1);
    // Body
    stamp(g, C.body[pose], 0, sh);
    if (C.skirt) {
      const sk = SKIRT[pose] || SKIRT.default;
      stamp(g, sk, 0, sh + 8);
    }
    // Head
    const H = HEADS[key];
    stamp(g, pose === 'dead' ? H.front : H.side, H.ox, H.oy);
    return g;
  }

  function characterPalette(key, form) {
    const C = CHARACTERS[key], F = FORMS[form];
    const pal = {
      h: C.hair, H: C.hairShade, s: C.skin, S: C.skinShade, r: C.blush, e: '#2a1a24', w: '#ffffff', m: '#a8323e',
      b: C.beard || C.hair,
      u: F.u, U: F.U, p: F.p, g: F.g, G: F.G,
      x: F.x || F.u, y: F.y || F.u,
      v: F.v === 'skin' ? C.skin : F.v,
      c: F.c, C: F.C, j: F.j, J: F.J, f: F.f, F: F.F,
    };
    if (F.stripe) {
      const base = { u: F.u, U: F.U, p: F.p, g: F.g };
      ['u', 'U', 'p', 'g'].forEach(k => { pal[k] = (x, y) => (y % 3 === 0 ? F.stripe : base[k]); });
    }
    return pal;
  }

  function buildCharacterSheet(key, form) {
    const { c, ctx } = canvas(FRAME_W * POSES.length, FRAME_H);
    POSES.forEach((pose, i) => {
      paint(ctx, composeCharacter(key, form, pose), characterPalette(key, form), i * FRAME_W, 0);
    });
    return c;
  }

  // ---------------------------------------------------------------- MONSTERS
  const MONSTERS = {
    skelly: { // walks like the classic mushroom enemy
      w: 16, h: 16,
      pal: { w: '#f4f0e6', W: '#c9c2b0', e: '#2a1a24', r: '#ff5a4a' },
      frames: [[
        '................',
        '.....wwwwww.....',
        '....wwwwwwww....',
        '...wwwwwwwwww...',
        '...weewwwweew...',
        '...werwwwwrew...',
        '...wwwwweWwww...',
        '....wwwwwwww....',
        '.....wewewe.....',
        '.......ww.......',
        '.....wwwwww.....',
        '......W..W......',
        '.....wwwwww.....',
        '......w..w......',
        '.....ww...w.....',
        '....www...ww....',
      ], [
        '................',
        '.....wwwwww.....',
        '....wwwwwwww....',
        '...wwwwwwwwww...',
        '...weewwwweew...',
        '...werwwwwrew...',
        '...wwwwweWwww...',
        '....wwwwwwww....',
        '.....wewewe.....',
        '.......ww.......',
        '.....wwwwww.....',
        '......W..W......',
        '.....wwwwww.....',
        '......w..w......',
        '......w...ww....',
        '.....ww...www...',
      ]],
      squish: [
        '................', '................', '................', '................',
        '................', '................', '................', '................',
        '................', '................',
        '.....wwwwww.....',
        '....weewweew....',
        '...wwwwwwwwww...',
        '..w.ww.ww.ww.w..',
        '.wwwWwwWwwWwwww.',
        'wwWwwwwwWwwwwWww',
      ],
    },
    jack: { // pumpkin: stomp it and kick the shell
      w: 16, h: 16,
      pal: { o: '#ff8a1e', O: '#c95a10', y: '#ffe14a', g: '#4a9a3a', f: '#3a7a2a', k: '#5a2a10' },
      frames: [[
        '.......gg.......',
        '......gg........',
        '...oooooooooo...',
        '..oooOooOooOoo..',
        '.ooooOooOooOooo.',
        '.oooyyoOoyyoooo.',
        '.ooyyyyOyyyyooo.',
        '.oooooOoOooooOo.',
        '.ooyoyoyoyoyooo.',
        '.oooyyyyyyyyooo.',
        '..ooOoooooOooo..',
        '...oooooooooo...',
        '....f......f....',
        '...ff......ff...',
        '..fff.....fff...',
        '................',
      ], [
        '.......gg.......',
        '......gg........',
        '...oooooooooo...',
        '..oooOooOooOoo..',
        '.ooooOooOooOooo.',
        '.oooyyoOoyyoooo.',
        '.ooyyyyOyyyyooo.',
        '.oooooOoOooooOo.',
        '.ooyoyoyoyoyooo.',
        '.oooyyyyyyyyooo.',
        '..ooOoooooOooo..',
        '...oooooooooo...',
        '.....f....f.....',
        '....ff....ff....',
        '...fff...fff....',
        '................',
      ]],
      shell: [[
        '................', '................', '................',
        '.......gg.......',
        '...oooooooooo...',
        '..oooOooOooOoo..',
        '.ooooOooOooOooo.',
        '.oookkoOokkoooo.',
        '.ooookoOokooooo.',
        '.oooooOoOooooOo.',
        '.ookokokokokooo.',
        '.oookkkkkkkkooo.',
        '..ooOoooooOooo..',
        '...oooooooooo...',
        '................', '................',
      ], [
        '................', '................', '................',
        '................',
        '...oooooooooo...',
        '..ooOoooOoooOo..',
        '.oooOoooOoooOoo.',
        '.ooOoooOoooOooo.',
        'goOooooOoooOoooo',
        'gooOoooOooooOoo.',
        '.oooOooOoooOooo.',
        '.oooOoooOoooOoo.',
        '..ooOoooOoooOo..',
        '...oooooooooo...',
        '................', '................',
      ]],
    },
    bat: {
      w: 16, h: 12,
      pal: { q: '#5a3a8a', Q: '#3a2460', r: '#ff4a4a', w: '#ffffff' },
      frames: [[
        'q..............q',
        'qq.....qq.....qq',
        'qqq...qqqq...qqq',
        'qqqq.qqqqqq.qqqq',
        '.qqqqqqqqqqqqqq.',
        '..QqqqrqqrqqqQ..',
        '...Q.qqwwqq.Q...',
        '......qqqq......',
        '................', '................', '................', '................',
      ], [
        '................', '................', '................',
        '.......qq.......',
        '......qqqq......',
        '.....qrqqrq.....',
        '...qqqqwwqqqq...',
        '..qqqqqqqqqqqq..',
        '.qqqQqqqqqqQqqq.',
        'qqQQ..qqqq..QQqq',
        'qQ............Qq',
        '................',
      ]],
    },
    mummy: {
      w: 16, h: 24,
      pal: { m: '#e8dcc0', M: '#b8a888', e: '#2a1a24', y: '#9aff6a', d: '#6a5a48' },
      frames: [[
        '................',
        '.....mmmmmm.....',
        '....mMmmmmMm....',
        '....mmmmmmmm....',
        '....mMeymeym....',
        '....mmmmmmmm....',
        '....mmMmmMmm....',
        '.....mmmmmm.....',
        '....mmMmmmmmmmmm',
        '...mmmmmmmmmmmMm',
        '...mMmmmmmMm....',
        '...mmmmMmmmm....',
        '....mmmmmmmm....',
        '....mMmmmmMm....',
        '....mmmmMmmm....',
        '....mmmmmmmm....',
        '.....mmmmmm.....',
        '.....mm..mM.....',
        '.....mM..mm.....',
        '.....mm..Mm.....',
        '.....Mm..mm.....',
        '....mmm..mmm....',
        '....ddd..ddd....',
        '................',
      ], [
        '................',
        '.....mmmmmm.....',
        '....mMmmmmMm....',
        '....mmmmmmmm....',
        '....mMeymeym....',
        '....mmmmmmmm....',
        '....mmMmmMmm....',
        '.....mmmmmm.....',
        '....mmMmmmmmmmmm',
        '...mmmmmmmmmmmMm',
        '...mMmmmmmMm....',
        '...mmmmMmmmm....',
        '....mmmmmmmm....',
        '....mMmmmmMm....',
        '....mmmmMmmm....',
        '....mmmmmmmm....',
        '.....mmmmmm.....',
        '.....mm..mM.....',
        '....mM....mm....',
        '....mm.....Mm...',
        '...Mm......mm...',
        '..mmm......mmm..',
        '..ddd......ddd..',
        '................',
      ]],
    },
    wolf: { // werewolf: hops
      w: 16, h: 24,
      pal: { f: '#8a7a6a', F: '#5e5044', e: '#ffe14a', k: '#2a1a24', w: '#ffffff', s: '#9a5ab8', S: '#6a3a8a', n: '#2a1a24', p: '#f28b9b' },
      frames: [[
        '..f.......f.....',
        '..ff.....ff.....',
        '..fpf...fpf.....',
        '..fffffffff.....',
        '..ffefffefff....',
        '..ffkfffkfffff..',
        '..ffffffffffffn.',
        '...fffffffwfwff.',
        '....fffffffffff.',
        '.....ffffff.....',
        '....sssssssss...',
        '...sSssssssSsf..',
        '..fsSssssssSs...',
        '...sSsssssssS...',
        '...sssssssssss..',
        '....sssssssss...',
        '.....FFFFFFF....',
        '.....FF...FF....',
        '.....FF...FF....',
        '....FF.....FF...',
        '....FF.....FF...',
        '...fff....fff...',
        '..ffff...ffff...',
        '................',
      ], [
        '..f.......f.....',
        '..ff.....ff.....',
        '..fpf...fpf.....',
        '..fffffffff.....',
        '..ffefffefff....',
        '..ffkfffkfffff..',
        '..ffffffffffffn.',
        '...fffffkkkkkk..',
        '....fffwffwfff..',
        '.....ffffff.....',
        '..f.sssssssss.f.',
        '..fsSssssssSsf..',
        '...sSssssssSs...',
        '...sSsssssssS...',
        '...sssssssssss..',
        '....sssssssss...',
        '.....FFFFFFF....',
        '....FF.....FF...',
        '...FF.......FF..',
        '..ff.........ff.',
        '.fff.........fff',
        '................',
        '................',
        '................',
      ]],
    },
    ghost: { // shy ghost: chases you when you look away
      w: 16, h: 16,
      pal: { w: '#f4f4ff', W: '#c8c8e8', e: '#2a1a24', p: '#f28b9b', m: '#a8323e' },
      frames: [[
        '................',
        '.....wwwwww.....',
        '...wwwwwwwwww...',
        '..wwwwwwwwwwww..',
        '..wwweewwweeww..',
        '.wwwweewwweewww.',
        '.wwwwwwwwwwwwww.',
        '.wwpwwmmmmwwpww.',
        '.wwwwwmmmmwwwww.',
        '.wwwwwwmmwwwwww.',
        '.Wwwwwwwwwwwwww.',
        '.WWwwwwwwwwwwwW.',
        '.WWWwwwwwwwwWWW.',
        '.WW.WWwwwwWW.WW.',
        '.W...WW.WW...W..',
        '................',
      ], [
        '................',
        '.....wwwwww.....',
        '...wwwwwwwwww...',
        '..wwwwwwwwwwww..',
        '..wwwwwwwwwwww..',
        '.wwwwwwwwwwwwww.',
        '.wWWwwwwwwwwWWw.',
        '.WwwWwwpwpwWwwW.',
        '.WwwWwwwwwwWwwW.',
        '.wWWwwwwwwwwWWw.',
        '.Wwwwwwwwwwwwww.',
        '.WWwwwwwwwwwwwW.',
        '.WWWwwwwwwwwWWW.',
        '.WW.WWwwwwWW.WW.',
        '.W...WW.WW...W..',
        '................',
      ]],
    },
    hand: { // zombie hand that pops out of pipes
      w: 16, h: 24,
      pal: { z: '#7ac84a', Z: '#4a8a2a', n: '#d8d0b8', s: '#6a3a8a', S: '#4a2460' },
      frames: [[
        '.....z..z.......',
        '..z..z..z..z....',
        '..z..z..z..z....',
        '..zz.zz.zz.z....',
        '..zz.zz.zz.zz...',
        '..zzzzzzzzzzz...',
        '..zzzzzzzzzzz...',
        '...zzzzzzzzzz.z.',
        '...zzzzzzzzzzzz.',
        '....zzzzzzzzzz..',
        '....zzzzzzzzz...',
        '.....zzzzzzz....',
        '.....ZzzzzzZ....',
        '.....sssssss....',
        '.....sSsssSs....',
        '.....sssssss....',
        '.....sSsssSs....',
        '.....sssssss....',
        '.....sSsssSs....',
        '.....sssssss....',
        '.....sSsssSs....',
        '.....sssssss....',
        '.....sSsssSs....',
        '.....sssssss....',
      ], [
        '................',
        '...z..z..z......',
        '...z..z..z..z...',
        '...zz.zz.zz.z...',
        '...zz.zz.zz.zz..',
        '...zzzzzzzzzzz..',
        '...zzzzzzzzzzz..',
        '..z.zzzzzzzzzz..',
        '..zzzzzzzzzzzz..',
        '...zzzzzzzzzzz..',
        '....zzzzzzzzz...',
        '.....zzzzzzz....',
        '.....ZzzzzzZ....',
        '.....sssssss....',
        '.....sSsssSs....',
        '.....sssssss....',
        '.....sSsssSs....',
        '.....sssssss....',
        '.....sSsssSs....',
        '.....sssssss....',
        '.....sSsssSs....',
        '.....sssssss....',
        '.....sSsssSs....',
        '.....sssssss....',
      ]],
    },
    vampire: { // Count Snoozula, the World 1 boss (32x32)
      w: 32, h: 32,
      pal: { k: '#2a1a34', K: '#1a1024', r: '#c8243a', R: '#8a1426', s: '#e8e8f4', S: '#b8b8d0', h: '#1a1024', e: '#ff3a4a', w: '#ffffff', y: '#ffd23f' },
      frames: [[
        '................................',
        '..........hhhhhhhhh.............',
        '.........hhhhhhhhhhh............',
        '........hhhhhhhhhhhhh...........',
        '........hhhhhhhhhhhhh...........',
        '........hhhshhhhshhhh...........',
        '........hhssshhsssshh...........',
        '.......rrhsessssesshrr..........',
        '......rrrhswssssswshrrr.........',
        '......rrrrsssssssssrrrr.........',
        '.....rrrrrssswwwsssrrrrr........',
        '.....rrRrrrsswswssrrrRrr........',
        '....rrRrrrrrssssrrrrrRrrr.......',
        '....rRrrkkkkkyykkkkkrrrRr.......',
        '...rrRrkkkkkkyykkkkkkrrRrr......',
        '...rRrkkkkkkkkkkkkkkkkrrRr......',
        '..rrRkkkkkkkkkkkkkkkkkkrRrr.....',
        '..rRrkkkKkkkkkkkkkkKkkkkrRr.....',
        '.rrRkkkkKkkkkkkkkkkKkkkkkRrr....',
        '.rRrkkkkKkkkkkkkkkkKkkkkkrRr....',
        'rrRkkkkkKkkkkkkkkkkKkkkkkkRrr...',
        'rRRkkkkkkkkkkkkkkkkkkkkkkkRRr...',
        'RRrkkkkkkkkkkkkkkkkkkkkkkkrRR...',
        'R..kkkkkkkkkkkkkkkkkkkkkkk..R...',
        '...kkkkkkkkkkkkkkkkkkkkkkk......',
        '....kkkkkkkkkkkkkkkkkkkkk.......',
        '.....kkkkkkk...kkkkkkkkk........',
        '......kkkkk.....kkkkkkk.........',
        '......kkkk.......kkkkk..........',
        '......kkkk.......kkkk...........',
        '.....ssssss.....ssssss..........',
        '.....ssssss.....ssssss..........',
      ]],
    },
  };
  // Second vampire frame: same body, eyes closed and feet wiggling (sleepy).
  MONSTERS.vampire.frames.push(MONSTERS.vampire.frames[0].map((row, y) => {
    if (y === 7) return row.replace('sessssess', 'sSSssssSS');
    if (y === 30 || y === 31) return '....ssssss.......ssssss.........';
    return row;
  }));

  function buildStrip(def, frames) {
    const { c, ctx } = canvas(def.w * frames.length, def.h);
    frames.forEach((rows, i) => paint(ctx, fromRows(rows), def.pal, i * def.w, 0));
    return c;
  }

  // ---------------------------------------------------------------- ITEMS
  const ITEMS = {
    candy: { // spinning wrapped candy (the coins)
      w: 16, h: 16,
      pal: { o: '#ff8a1e', O: '#c95a10', y: '#ffe14a', w: '#ffffff', p: '#ff6ac8', P: '#c83a96' },
      frames: [[
        '................', '................', '................', '................',
        '.p..........p...',
        '.pp..oooooo.pp..',
        '.ppPoowwyyooPpp.',
        '.pppoowyyyyoppp.',
        '.ppPooyyyyOoPpp.',
        '.pp..oOOOOo.pp..',
        '.p...........p..',
        '................', '................', '................', '................', '................',
      ], [
        '................', '................', '................', '................',
        '................',
        '....p.oooo.p....',
        '....pPowyoPp....',
        '....ppoyyopp....',
        '....pPoyOoPp....',
        '....p.oOOo.p....',
        '................',
        '................', '................', '................', '................', '................',
      ], [
        '................', '................', '................', '................',
        '................',
        '.......oo.......',
        '......pwyp......',
        '......pyyp......',
        '......pyOp......',
        '.......OO.......',
        '................',
        '................', '................', '................', '................', '................',
      ]],
    },
    cape: { // Hero Cape power-up (slides along like the classic mushroom)
      w: 16, h: 16,
      pal: { c: '#e0342f', C: '#a82420', y: '#ffd23f', w: '#ffffff' },
      frames: [[
        '................',
        '....yyyyyyyy....',
        '...ycccccccccy..',
        '...cccccccccc...',
        '..cccccyycccc...',
        '..ccccyyyycccC..',
        '..cccccyyccccC..',
        '.cccccccccccccC.',
        '.cccccccccccccC.',
        '.ccccccccccccCC.',
        'cccccccccccccCCC',
        'ccccccccccccCCCC',
        'cCccCcccCcccCcCC',
        '.C..C...C...C.C.',
        '................',
        '................',
      ]],
    },
    rocket: { // Rocket Suit power-up
      w: 16, h: 16,
      pal: { r: '#d23a2e', R: '#902020', g: '#f2b632', w: '#ffffff', b: '#7ff0ff', f: '#ffd23f', F: '#ff7a1a' },
      frames: [[
        '.......rr.......',
        '......rrrr......',
        '......rrrr......',
        '.....rrbbrr.....',
        '.....rbbwbr.....',
        '.....rrbbrr.....',
        '.....rrrrrr.....',
        '.....rRrrRr.....',
        '....grrrrrrg....',
        '...ggrRrrRrgg...',
        '...gg.rrrr.gg...',
        '......gggg......',
        '.....fFffFf.....',
        '......fFFf......',
        '.......ff.......',
        '................',
      ], [
        '.......rr.......',
        '......rrrr......',
        '......rrrr......',
        '.....rrbbrr.....',
        '.....rbbwbr.....',
        '.....rrbbrr.....',
        '.....rrrrrr.....',
        '.....rRrrRr.....',
        '....grrrrrrg....',
        '...ggrRrrRrgg...',
        '...gg.rrrr.gg...',
        '......gggg......',
        '......fFFf......',
        '.......ff.......',
        '................',
        '................',
      ]],
    },
    star: { // Hero Star: invincibility
      w: 16, h: 16,
      pal: { y: '#ffe14a', Y: '#ffb01a', w: '#ffffff', e: '#2a1a24' },
      frames: [[
        '.......yy.......',
        '.......yy.......',
        '......yyyy......',
        '......yyyy......',
        'yyyyyyywyyyyyyyy',
        '.yyyyyyyyyyyyyy.',
        '..yyyeyyyyeyyy..',
        '...yyeyyyyeyy...',
        '....yyyyyyyy....',
        '....yyyyyyyy....',
        '...yyyyYYyyyy...',
        '...yyyYYYYyyy...',
        '..yyyY....Yyyy..',
        '..yyY......Yyy..',
        '.yYY........YYy.',
        '.Y............Y.',
      ]],
    },
    egg: { // Dino egg: extra life
      w: 16, h: 16,
      pal: { e: '#f4f0e6', E: '#c9c2b0', g: '#5ac85a', G: '#3a8a3a' },
      frames: [[
        '................',
        '......eeee......',
        '.....eeggee.....',
        '....eeeggeee....',
        '....egeeeege....',
        '...eggeeeeggE...',
        '...egeeggeeeE...',
        '...eeeeggeegE...',
        '...eggeeeeggE...',
        '...eggeeeeeeE...',
        '...eeeeggeeeE...',
        '....eeeggeeE....',
        '....EeeeeeEE....',
        '.....EEEEEE.....',
        '................',
        '................',
      ]],
    },
    blast: { // rocket suit shot
      w: 8, h: 8,
      pal: { b: '#7ff0ff', w: '#ffffff', B: '#2ab0ff' },
      frames: [[
        '..bbbb..', '.bwwwwb.', 'bwwwwwwb', 'bwwwwwwB', 'bwwwwwwB', 'Bwwwwwwb', '.BwwwwB.', '..BBBB..',
      ], [
        '...bb...', '..bwwb..', '.bwwwwb.', 'bwwwwwwB', 'BwwwwwwB', '.BwwwwB.', '..BwwB..', '...BB...',
      ]],
    },
  };

  // ---------------------------------------------------------------- TILES (16x16)
  function tileCanvas(draw) {
    const { c, ctx } = canvas(16, 16);
    draw(ctx);
    return c;
  }
  function px(ctx, x, y, col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); }
  function rect(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }

  // Deterministic pseudo-random for texture speckles.
  function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

  const TILES = {};
  // Rooftops: shingled roof edge on top of a brick wall.
  function roofWall(ctx, T) {
    rect(ctx, 0, 0, 16, 16, T.mortar);
    [[0, 0, 7], [8, 0, 7], [0, 4, 3], [4, 4, 7], [12, 4, 4], [0, 8, 7], [8, 8, 7], [0, 12, 3], [4, 12, 7], [12, 12, 4]].forEach(([x, y, w]) => {
      rect(ctx, x, y, w, 3, T.brick); rect(ctx, x, y, w, 1, T.brickLight);
    });
  }
  // Castle floors: big grey stone blocks.
  function castleStone(ctx, T) {
    rect(ctx, 0, 0, 16, 16, T.stoneDark);
    [[0, 0, 7, 7], [8, 0, 8, 7], [0, 8, 3, 8], [4, 8, 8, 8], [13, 8, 3, 8]].forEach(([x, y, w, h]) => {
      rect(ctx, x, y, w, h - 1, T.stone); rect(ctx, x, y, w, 1, T.stoneLight); rect(ctx, x, y, 1, h - 1, T.stoneLight);
    });
  }
  TILES.groundTop = (theme) => tileCanvas(ctx => {
    const T = THEMES[theme];
    if (theme === 'castle') { castleStone(ctx, T); rect(ctx, 0, 0, 16, 2, T.stoneLight); return; }
    if (theme === 'roof') {
      roofWall(ctx, T);
      rect(ctx, 0, 0, 16, 7, '#3a2458');
      for (let x = 0; x < 16; x += 4) { rect(ctx, x, 3, 4, 4, '#4e3474'); px(ctx, x, 6, '#2a1840'); px(ctx, x + 3, 6, '#2a1840'); rect(ctx, x + 1, 4, 2, 1, '#6a4a94'); }
      rect(ctx, 0, 0, 16, 2, '#7a5aa8'); rect(ctx, 0, 2, 16, 1, '#2a1840');
      rect(ctx, 0, 7, 16, 1, '#1e1428');
      return;
    }
    rect(ctx, 0, 0, 16, 16, T.dirt);
    const r = rng(7);
    for (let i = 0; i < 10; i++) px(ctx, Math.floor(r() * 16), 5 + Math.floor(r() * 11), T.dirtDark);
    for (let i = 0; i < 4; i++) px(ctx, Math.floor(r() * 16), 6 + Math.floor(r() * 10), T.dirtLight);
    rect(ctx, 0, 0, 16, 4, T.grass);
    rect(ctx, 0, 4, 16, 1, T.grassDark);
    [1, 4, 6, 9, 12, 14].forEach(x => px(ctx, x, 5, T.grassDark));
    [2, 7, 11].forEach(x => px(ctx, x, 6, T.grassDark));
    [0, 3, 5, 8, 10, 13, 15].forEach(x => px(ctx, x, 0, T.grassLight));
  });
  TILES.ground = (theme) => tileCanvas(ctx => {
    const T = THEMES[theme];
    if (theme === 'roof') { roofWall(ctx, T); return; }
    if (theme === 'castle') { castleStone(ctx, T); return; }
    rect(ctx, 0, 0, 16, 16, T.dirt);
    const r = rng(11);
    for (let i = 0; i < 12; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), T.dirtDark);
    for (let i = 0; i < 5; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), T.dirtLight);
  });
  TILES.brick = (theme) => tileCanvas(ctx => {
    const T = THEMES[theme];
    rect(ctx, 0, 0, 16, 16, T.mortar);
    const rows = [[0, 0, 7], [8, 0, 7], [0, 4, 3], [4, 4, 7], [12, 4, 4], [0, 8, 7], [8, 8, 7], [0, 12, 3], [4, 12, 7], [12, 12, 4]];
    rows.forEach(([x, y, w]) => {
      rect(ctx, x, y, w, 3, T.brick);
      rect(ctx, x, y, w, 1, T.brickLight);
      rect(ctx, x, y + 2, w, 1, T.brickDark);
    });
  });
  TILES.block = (frame) => tileCanvas(ctx => { // candy "?" block
    const base = ['#ff9a2a', '#ffb24a', '#ff9a2a'][frame], dark = '#b85a10', light = '#ffd27a';
    rect(ctx, 0, 0, 16, 16, OUTLINE);
    rect(ctx, 1, 1, 14, 14, base);
    rect(ctx, 1, 1, 14, 1, light); rect(ctx, 1, 1, 1, 14, light);
    rect(ctx, 1, 14, 14, 1, dark); rect(ctx, 14, 1, 1, 14, dark);
    [[2, 2], [13, 2], [2, 13], [13, 13]].forEach(([x, y]) => px(ctx, x, y, dark));
    const q = ['..kkkk..', '.kk..kk.', '.....kk.', '....kk..', '...kk...', '...kk...', '........', '...kk...'];
    q.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'k') { px(ctx, 4 + x, 4 + y, '#5a2a10'); px(ctx, 5 + x, 4 + y, '#5a2a10'); } }));
    q.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'k') px(ctx, 4 + x, 4 + y, frame === 1 ? '#ffffff' : '#fff2c8'); }));
  });
  TILES.used = () => tileCanvas(ctx => {
    rect(ctx, 0, 0, 16, 16, OUTLINE);
    rect(ctx, 1, 1, 14, 14, '#8a5a3a');
    rect(ctx, 1, 14, 14, 1, '#5a3a24'); rect(ctx, 14, 1, 1, 14, '#5a3a24');
    [[2, 2], [13, 2], [2, 13], [13, 13]].forEach(([x, y]) => px(ctx, x, y, '#5a3a24'));
  });
  TILES.hard = (theme) => tileCanvas(ctx => {
    const T = THEMES[theme];
    rect(ctx, 0, 0, 16, 16, T.stoneDark);
    rect(ctx, 1, 1, 14, 14, T.stone);
    rect(ctx, 1, 1, 14, 2, T.stoneLight); rect(ctx, 1, 1, 2, 14, T.stoneLight);
    rect(ctx, 3, 13, 12, 2, T.stoneDark); rect(ctx, 13, 3, 2, 12, T.stoneDark);
  });
  function pipePiece(left, top) {
    return tileCanvas(ctx => {
      const g = '#3aa84a', G = '#1e6a2e', L = '#8ae06a';
      if (top) {
        rect(ctx, 0, 0, 16, 16, OUTLINE);
        if (left) { rect(ctx, 1, 1, 15, 14, g); rect(ctx, 3, 1, 3, 14, L); rect(ctx, 1, 1, 1, 14, G); }
        else { rect(ctx, 0, 1, 15, 14, g); rect(ctx, 9, 1, 5, 14, G); rect(ctx, 2, 1, 2, 14, L); }
        rect(ctx, 0, 15, 16, 1, OUTLINE);
      } else {
        rect(ctx, 0, 0, 16, 16, 'rgba(0,0,0,0)');
        if (left) { rect(ctx, 2, 0, 14, 16, OUTLINE); rect(ctx, 3, 0, 13, 16, g); rect(ctx, 5, 0, 3, 16, L); }
        else { rect(ctx, 0, 0, 14, 16, OUTLINE); rect(ctx, 0, 0, 13, 16, g); rect(ctx, 7, 0, 5, 16, G); rect(ctx, 1, 0, 2, 16, L); }
      }
    });
  }
  TILES.pipeTL = () => pipePiece(true, true);
  TILES.pipeTR = () => pipePiece(false, true);
  TILES.pipeL = () => pipePiece(true, false);
  TILES.pipeR = () => pipePiece(false, false);
  TILES.plank = () => tileCanvas(ctx => { // one-way platform (fence top / rooftop ledge)
    rect(ctx, 0, 0, 16, 6, OUTLINE);
    rect(ctx, 0, 1, 16, 4, '#9a6a44');
    rect(ctx, 0, 1, 16, 1, '#c89a6a');
    [3, 11].forEach(x => rect(ctx, x, 1, 1, 4, '#5a3a24'));
  });
  TILES.goo = (frame) => tileCanvas(ctx => { // bubbling potion (castle hazard)
    rect(ctx, 0, 0, 16, 16, '#3a9a2a');
    rect(ctx, 0, 0, 16, 3, '#7ae04a');
    const r = rng(3 + frame * 5);
    for (let i = 0; i < 6; i++) px(ctx, Math.floor(r() * 16), 4 + Math.floor(r() * 12), '#2a6a1e');
    px(ctx, (frame * 5) % 16, 1, '#c8ff9a'); px(ctx, (frame * 5 + 8) % 16, 2, '#c8ff9a');
  });

  const THEMES = {
    street:  { grass: '#3a8a5a', grassDark: '#24603e', grassLight: '#5ab87a', dirt: '#7a4a3a', dirtDark: '#5a3428', dirtLight: '#9a6a54', mortar: '#2a1a34', brick: '#8a4ab0', brickLight: '#b07ad0', brickDark: '#5a2a7a', stone: '#8a8aa8', stoneLight: '#b8b8d0', stoneDark: '#4a4a68', sky: ['#1a1440', '#3a2a6a', '#6a3a7a'] },
    crypt:   { grass: '#5a5a7a', grassDark: '#3a3a54', grassLight: '#7a7a9a', dirt: '#3a3048', dirtDark: '#24202e', dirtLight: '#54486a', mortar: '#120c18', brick: '#3a5a8a', brickLight: '#5a7aaa', brickDark: '#24385a', stone: '#6a6a88', stoneLight: '#9090b0', stoneDark: '#3a3a54', sky: ['#05040a', '#0a0814', '#140e22'] },
    roof:    { grass: '#6a4a8a', grassDark: '#4a2e66', grassLight: '#8a6aaa', dirt: '#8a5a4a', dirtDark: '#6a3e32', dirtLight: '#aa7a64', mortar: '#2a1a34', brick: '#b05a3a', brickLight: '#d08a6a', brickDark: '#7a3a24', stone: '#8a8aa8', stoneLight: '#b8b8d0', stoneDark: '#4a4a68', sky: ['#0e1030', '#2a2060', '#8a4a6a'] },
    castle:  { grass: '#5a5a6a', grassDark: '#3a3a48', grassLight: '#7a7a8a', dirt: '#4a4450', dirtDark: '#2e2a34', dirtLight: '#66606e', mortar: '#140e18', brick: '#5a5468', brickLight: '#7a7488', brickDark: '#3a3448', stone: '#6a6478', stoneLight: '#8a849a', stoneDark: '#3a3448', sky: ['#0a0610', '#1a0e1e', '#2a1222'] },
  };

  // ---------------------------------------------------------------- SCENERY
  function moon(r) {
    const s = r * 2 + 4;
    const { c, ctx } = canvas(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = x - s / 2 + 0.5, dy = y - s / 2 + 0.5, d = Math.sqrt(dx * dx + dy * dy);
      if (d < r) px(ctx, x, y, d > r - 1.5 ? '#f2e2a0' : '#fff4c8');
      else if (d < r + 2) { ctx.globalAlpha = 0.25; px(ctx, x, y, '#fff4c8'); ctx.globalAlpha = 1; }
    }
    [[0.35, 0.4, 3], [0.6, 0.3, 2], [0.55, 0.65, 4], [0.3, 0.7, 2]].forEach(([fx, fy, cr]) => {
      for (let y = -cr; y <= cr; y++) for (let x = -cr; x <= cr; x++) if (x * x + y * y <= cr * cr) px(ctx, Math.round(s * fx + x), Math.round(s * fy + y), '#eadb9a');
    });
    return c;
  }

  // Row of house silhouettes for parallax. spooky=true gives pointy Victorian roofs.
  function houses(w, h, col, winCol, seed, spooky) {
    const { c, ctx } = canvas(w, h);
    const r = rng(seed);
    let x = 0;
    while (x < w) {
      const hw = 28 + Math.floor(r() * 24), hh = 30 + Math.floor(r() * 30);
      const top = h - hh;
      rect(ctx, x, top, hw, hh, col);
      // roof
      const peak = spooky ? 18 + Math.floor(r() * 10) : 10;
      for (let i = 0; i < hw / 2; i++) {
        const rh = Math.round(peak * (1 - i / (hw / 2)));
        rect(ctx, x + i, top - rh, 1, rh, col);
        rect(ctx, x + hw - 1 - i, top - rh, 1, rh, col);
      }
      if (spooky && r() > 0.4) { // little tower
        const tx = x + Math.floor(hw * 0.7);
        rect(ctx, tx, top - peak - 6, 6, peak + 6, col);
        for (let i = 0; i < 3; i++) rect(ctx, tx + i, top - peak - 6 - (3 - i) * 3, 6 - i * 2, 3, col);
      }
      // windows
      for (let wy = top + 6; wy < h - 10; wy += 12) for (let wx = x + 4; wx < x + hw - 6; wx += 10) {
        if (r() > 0.45) { rect(ctx, wx, wy, 4, 6, winCol); rect(ctx, wx, wy + 2, 4, 1, col); }
      }
      x += hw + 4 + Math.floor(r() * 10);
    }
    return c;
  }

  function trees(w, h, col, seed) {
    const { c, ctx } = canvas(w, h);
    const r = rng(seed);
    for (let x = 0; x < w; x += 40 + Math.floor(r() * 40)) {
      const th = 30 + Math.floor(r() * 30);
      rect(ctx, x + 6, h - th, 3, th, col);
      // bare spooky branches
      for (let b = 0; b < 5; b++) {
        const by = h - th + Math.floor(r() * th * 0.6), dir = r() > 0.5 ? 1 : -1, len = 6 + Math.floor(r() * 8);
        for (let i = 0; i < len; i++) px(ctx, x + 7 + dir * i, by - Math.floor(i / 2), col);
      }
    }
    // rolling hill line
    for (let x = 0; x < w; x++) {
      const hy = Math.round(h - 6 - 4 * Math.sin(x / 30 + seed) - 2 * Math.sin(x / 11));
      rect(ctx, x, hy, 1, h - hy, col);
    }
    return c;
  }

  function stars(w, h, seed) {
    const { c, ctx } = canvas(w, h);
    const r = rng(seed);
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(r() * w), y = Math.floor(r() * h * 0.7);
      px(ctx, x, y, r() > 0.7 ? '#fff4c8' : '#9a9ad0');
    }
    return c;
  }

  const DECOR = {
    grave: {
      w: 16, h: 16, pal: { s: '#8a8aa8', S: '#5a5a78', k: '#3a3a54', g: '#3a8a5a' }, frames: [[
        '................', '................', '.....ssssss.....', '....ssssssSS....', '...sssssssssS...', '...ssksskssS....',
        '...sskkkkssS....', '...ssskksssS....', '...ssskksssS....', '...sssssssSS....', '...sssssssSS....', '...sssssssSS....',
        '...sssssssSS....', '..ggsssssssSgg..', '.gggggggggggggg.', '................']],
    },
    bush: {
      w: 32, h: 16, pal: { g: '#2e6a4a', G: '#1e4a34', l: '#4a8a64' }, frames: [[
        '................................', '................................', '................................', '................................',
        '..........llll.........ll.......', '.......lllggggll.....llggll.....', '.....llgggggggggl...lgggggggl...', '....lggggggGggggggllggggGggggl..',
        '...lgggGgggggggGgggggggggggGggl.', '..lggggggggGgggggggGgggggggggggl', '..gggGggggggggggggggggGggggggggg', '.gggggggggGggggggGggggggggggGggg',
        '.ggGggggggggggGgggggggggGgggggggg', 'gggggggGgggggggggggGgggggggggggg', 'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', '................................']],
    },
    lantern: { // jack-o-lantern on the ground
      w: 16, h: 16, pal: { o: '#ff8a1e', O: '#c95a10', y: '#ffe14a', g: '#4a9a3a' }, frames: [[
        '................', '................', '................', '................', '.......gg.......', '......gg........',
        '....oooooooo....', '...ooOooOooOo...', '..oooyyoOyyooo..', '..ooooOooOoooo..', '..oooyyyyyyooo..', '..ooOoyoyoyOoo..',
        '...oooooooooo...', '....oooooooo....', '................', '................']],
    },
    fence: {
      w: 16, h: 16, pal: { f: '#3a2a4a', F: '#2a1e36' }, frames: [[
        '..f.......f.....', '.fff.....fff....', '.fff.....fff....', '.fff.....fff....', 'ffffffffffffffff', 'FFFFFFFFFFFFFFFF',
        '.fff.....fff....', '.fff.....fff....', '.fff.....fff....', '.fff.....fff....', 'ffffffffffffffff', 'FFFFFFFFFFFFFFFF',
        '.fff.....fff....', '.fff.....fff....', '.fff.....fff....', '.fff.....fff....']],
    },
    lamp: {
      w: 16, h: 48, pal: { k: '#3a3a54', y: '#ffe14a', Y: '#fff4c8' }, frames: [[
        '................', '......kkkk......', '.....kyyyyk.....', '.....kyYYyk.....', '.....kyYYyk.....', '.....kyyyyk.....', '......kkkk......',
        '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......',
        '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......',
        '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......',
        '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......',
        '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......', '.......kk.......',
        '.......kk.......', '.......kk.......', '.......kk.......', '.....kkkkkk.....', '....kkkkkkkk....', '................']],
    },
  };

  // The goal: a flagpole with a pumpkin on top, and the house with the door to knock on.
  function flagpole(heightTiles) {
    const h = heightTiles * 16;
    const { c, ctx } = canvas(16, h);
    rect(ctx, 7, 8, 2, h - 8, '#c8ccd8');
    rect(ctx, 7, 8, 1, h - 8, '#ffffff');
    const top = fromRows(['..gg..', '.oooo.', 'oyoyoo', 'oooooo', '.oyyo.', '..oo..']);
    paint(ctx, top, { o: '#ff8a1e', y: '#5a2a10', g: '#4a9a3a' }, 5, 0);
    return c;
  }
  function flag() {
    const { c, ctx } = canvas(16, 14);
    const g = fromRows([
      'oooooooooooooo', 'ooooooooooooo.', 'oooookkooooo..', 'ooookkkkoooo..', 'oookkwkkkooo..', 'ooookkkkooo...',
      'oooookkoooo...', 'ooooooooooo...', 'ooooooooooooo.', 'oooooooooooooo',
    ]);
    paint(ctx, g, { o: '#ff8a1e', k: '#2a1a24', w: '#ffffff' }, 1, 2);
    return c;
  }
  // House for the end of each level. spooky=true is a Villainville house.
  function house(spooky) {
    const W = 96, H = 96;
    const { c, ctx } = canvas(W, H);
    const wall = spooky ? '#6a4a9a' : '#5a7ab0', wallD = spooky ? '#4a3070' : '#3a5a8a', roof = spooky ? '#3a2458' : '#4a3a5a';
    rect(ctx, 8, 40, 80, 56, OUTLINE); rect(ctx, 9, 41, 78, 55, wall);
    for (let y = 44; y < 96; y += 4) rect(ctx, 9, y, 78, 1, wallD);
    for (let i = 0; i < 48; i++) { const rh = Math.round((spooky ? 40 : 32) * (1 - Math.abs(i - 48) / 48)); }
    for (let x = 0; x < 96; x++) {
      const rh = Math.max(0, Math.round((spooky ? 40 : 30) - Math.abs(x - 48) * (spooky ? 0.85 : 0.65)));
      rect(ctx, x, 41 - rh, 1, rh, roof);
      px(ctx, x, 41 - rh, OUTLINE);
    }
    if (spooky) { rect(ctx, 66, 2, 10, 30, roof); for (let i = 0; i < 5; i++) rect(ctx, 66 + i, 2 - (5 - i) * 2, 10 - i * 2, 2, roof); }
    // windows (lit)
    [[18, 50], [64, 50]].forEach(([x, y]) => { rect(ctx, x - 1, y - 1, 16, 16, OUTLINE); rect(ctx, x, y, 14, 14, '#ffd86a'); rect(ctx, x + 6, y, 2, 14, OUTLINE); rect(ctx, x, y + 6, 14, 2, OUTLINE); });
    // door
    rect(ctx, 39, 62, 18, 34, OUTLINE); rect(ctx, 40, 63, 16, 33, spooky ? '#5a2a3a' : '#3a8a5a');
    rect(ctx, 42, 66, 5, 12, spooky ? '#6a3a4a' : '#4aa06a'); rect(ctx, 49, 66, 5, 12, spooky ? '#6a3a4a' : '#4aa06a');
    rect(ctx, 52, 80, 2, 2, '#ffd23f');
    // porch light
    rect(ctx, 34, 64, 3, 4, '#ffd86a');
    if (spooky) { // cobweb
      for (let i = 0; i < 10; i++) { px(ctx, 9 + i, 41 + i, '#c8c8e8'); px(ctx, 9 + i, 41, '#c8c8e8'); px(ctx, 9, 41 + i, '#c8c8e8'); }
    }
    return c;
  }

  // Sonny's emblem for the title screen (placeholder until Sonny picks his own).
  function bigStar(size) {
    const { c, ctx } = canvas(size, size);
    const cx = size / 2, cy = size / 2, R = size / 2 - 1, r = R * 0.45;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r : R;
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fillStyle = '#ffd23f'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = OUTLINE; ctx.stroke();
    return c;
  }

  function particle(col, size) {
    const { c, ctx } = canvas(size, size);
    rect(ctx, 0, 0, size, size, col);
    return c;
  }

  // ---------------------------------------------------------------- REGISTER WITH PHASER
  function addStrip(scene, key, cnv, fw, fh) {
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const tex = scene.textures.addCanvas(key, cnv);
    const n = Math.floor(cnv.width / fw);
    for (let i = 0; i < n; i++) tex.add(i, 0, i * fw, 0, fw, fh);
    return tex;
  }

  function registerAll(scene) {
    Object.keys(CHARACTERS).forEach(k => Object.keys(FORMS).forEach(f => addStrip(scene, `${k}_${f}`, buildCharacterSheet(k, f), FRAME_W, FRAME_H)));
    Object.entries(MONSTERS).forEach(([k, d]) => {
      addStrip(scene, k, buildStrip(d, d.frames), d.w, d.h);
      if (d.squish) addStrip(scene, k + '_squish', buildStrip(d, [d.squish]), d.w, d.h);
      if (d.shell) addStrip(scene, k + '_shell', buildStrip(d, d.shell), d.w, d.h);
    });
    Object.entries(ITEMS).forEach(([k, d]) => addStrip(scene, k, buildStrip(d, d.frames), d.w, d.h));
    Object.entries(DECOR).forEach(([k, d]) => addStrip(scene, 'decor_' + k, buildStrip(d, d.frames), d.w, d.h));

    // Tilesets: one strip per theme. Index order matters (see TILE in levels.js).
    Object.keys(THEMES).forEach(theme => {
      const tiles = [
        TILES.groundTop(theme), TILES.ground(theme), TILES.brick(theme), TILES.block(0), TILES.used(),
        TILES.hard(theme), TILES.pipeTL(), TILES.pipeTR(), TILES.pipeL(), TILES.pipeR(), TILES.plank(), TILES.goo(0),
      ];
      const { c, ctx } = canvas(16 * tiles.length, 16);
      tiles.forEach((t, i) => ctx.drawImage(t, i * 16, 0));
      addStrip(scene, 'tiles_' + theme, c, 16, 16);
      addStrip(scene, 'brick_' + theme, TILES.brick(theme), 16, 16);
      const sky = THEMES[theme].sky;
      const g = canvas(4, 224);
      const grad = g.ctx.createLinearGradient(0, 0, 0, 224);
      grad.addColorStop(0, sky[0]); grad.addColorStop(0.6, sky[1]); grad.addColorStop(1, sky[2]);
      g.ctx.fillStyle = grad; g.ctx.fillRect(0, 0, 4, 224);
      addStrip(scene, 'sky_' + theme, g.c, 4, 224);
    });
    const blockAnim = canvas(48, 16);
    [0, 1, 2].forEach(i => blockAnim.ctx.drawImage(TILES.block(i), i * 16, 0));
    addStrip(scene, 'block_anim', blockAnim.c, 16, 16);
    addStrip(scene, 'used', TILES.used(), 16, 16);
    const gooAnim = canvas(48, 16);
    [0, 1, 2].forEach(i => gooAnim.ctx.drawImage(TILES.goo(i), i * 16, 0));
    addStrip(scene, 'goo', gooAnim.c, 16, 16);

    addStrip(scene, 'moon', moon(18), 40, 40);
    addStrip(scene, 'stars', stars(400, 224, 5), 400, 224);
    addStrip(scene, 'houses_far', houses(512, 120, '#2a1e4e', '#6a5a3a', 3, true), 512, 120);
    addStrip(scene, 'houses_near', houses(640, 110, '#1a1236', '#c8a04a', 9, false), 640, 110);
    addStrip(scene, 'trees', trees(512, 90, '#120c22', 2), 512, 90);
    addStrip(scene, 'flagpole', flagpole(10), 16, 160);
    addStrip(scene, 'flag', flag(), 16, 14);
    addStrip(scene, 'house_hero', house(false), 96, 96);
    addStrip(scene, 'house_villain', house(true), 96, 96);
    addStrip(scene, 'bigstar', bigStar(48), 48, 48);
    addStrip(scene, 'px_white', particle('#ffffff', 2), 2, 2);
    addStrip(scene, 'px_brick', particle('#b07ad0', 4), 4, 4);
    addStrip(scene, 'px_bone', particle('#f4f0e6', 3), 3, 3);
    addStrip(scene, 'px_orange', particle('#ff8a1e', 3), 3, 3);
  }

  window.ART = { registerAll, CHARACTERS, FORMS, POSES, THEMES, buildCharacterSheet, buildStrip, MONSTERS, ITEMS, FRAME_W, FRAME_H };
})();
