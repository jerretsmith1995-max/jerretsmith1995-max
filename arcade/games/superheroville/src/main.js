// Game state and start-up.
(function () {
  'use strict';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('superheroville') || '{}'); } catch (e) { saved = {}; }

  window.GAME = {
    character: saved.character || 'sonny',
    lives: 3, score: 0, candy: 0, form: 'pajamas', checkpoint: -1, lastLevel: 0,
    best: saved.best || 0, unlocked: saved.unlocked || 0,
  };

  window.newGame = function (character) {
    Object.assign(GAME, { character, lives: 3, score: 0, candy: 0, form: 'pajamas', checkpoint: -1 });
    saveBest();
  };
  window.saveBest = function () {
    GAME.best = Math.max(GAME.best || 0, GAME.score);
    try { localStorage.setItem('superheroville', JSON.stringify({ best: GAME.best, unlocked: GAME.unlocked, character: GAME.character })); } catch (e) { /* ignore */ }
  };
  // Where Esc / the home button goes. The phone version has no arcade menu, so it
  // sets ARCADE_URL = null and goes back to the title screen instead.
  window.exitToArcade = function () {
    SOUND.stopMusic();
    saveBest();
    const url = window.ARCADE_URL === undefined ? '../../index.html' : window.ARCADE_URL;
    if (url) { window.location.href = url; return; }
    const g = window.game;
    if (!g) return;
    g.scene.getScenes(true).forEach(s => { if (s.scene.key !== 'Title') s.scene.stop(); });
    g.scene.start('Title');
  };

  const config = {
    type: Phaser.AUTO,
    parent: 'game',
    width: 400, height: 224,
    pixelArt: true, roundPixels: true,
    backgroundColor: '#0a0618',
    input: { gamepad: true },
    physics: { default: 'arcade', arcade: { gravity: { y: 900 }, fps: 60, debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [SCREENS.BootScene, SCREENS.TitleScene, SCREENS.SelectScene, SCREENS.IntroScene, GameScene, SCREENS.GameOverScene, SCREENS.EndingScene],
  };
  window.game = new Phaser.Game(config);
})();
