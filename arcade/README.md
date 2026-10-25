# Sonny's Arcade

A fullscreen game launcher for the Mac, starring Sonny, Dada, Mama and baby Meadow.
Everything runs offline from local files.

## Start it

```bash
./start-arcade.command
```

Or double-click `start-arcade.command` in Finder. It opens Google Chrome in fullscreen
"kiosk" mode. **Quit with Cmd+Q.** Without Chrome it falls back to Safari.

## Games

| Game | Status |
|---|---|
| **Superheroville**: a Halloween platformer in the spirit of the classic Mario games | World 1 playable (4 levels + boss) |
| Cross the Street | Coming soon |
| Star Knight | Coming soon |

## Superheroville controls

| | Keyboard | Controller |
|---|---|---|
| Move | Arrows or WASD | D-pad / left stick |
| Jump (hold for higher) | Space, Z or Up | A / B |
| Run, and shoot in the Rocket Suit | Shift or X | X / Y |
| Pause | Enter or P | Start |
| Back to the arcade | Esc | Select |
| Sound on/off | M | |

**Characters:** Sonny (all-rounder), Dada (fastest runner), Mama (hold jump to hover).

**Power-ups** (from the orange "?" candy blocks):
- **Hero Cape**: turns pajamas into the hero suit. You can take a hit, break bricks,
  and hold jump while falling to glide.
- **Rocket Suit**: shoot blasts with the run button; press jump again in mid-air to fly for a moment.
- **Hero Star**: invincible for 10 seconds.
- **Dino Egg**: extra life. 100 candies also give an extra life.

**Monsters:** skeletons (stomp them), pumpkins (stomp, then kick the shell),
bats, mummies, hopping werewolves, shy ghosts (they only move when you look away),
zombie hands in pipes (don't stomp these), and Count Snoozula, the World 1 boss.

## World 1

1. **Superheroville Street**: the basics: blocks, pipes, pits and the flagpole.
2. **Creepy Crypt**: underground with ghosts and zombie hands.
3. **Rooftop Run**: moving platforms high above the street.
4. **Count Snoozula's Castle**: candle bars, potion pits and the boss. Bop him three times
   and he gets too sleepy to fight, so you tuck your cape over his cold toes (just like in the book).

Every level ends by knocking on a door: "KNOCK KNOCK! WHO LIVES HERE?"

## How it's made

- Engine: [Phaser 3.90](https://phaser.io) (MIT licence), stored in `games/superheroville/lib/` so no internet is needed.
- All art is pixel art generated in code (`src/art.js`). The family designs are based on the family book
  *Sonny and the Two Sides of the Street*. See [ASSETS.md](ASSETS.md) for where every asset comes from.
- All music and sound effects are original, played by a small chiptune synth in `src/sound.js`.
- No build step: plain JavaScript files that also run straight from `file://`.
