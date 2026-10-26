# Bar Down

A 3D hockey game that runs in the browser. You're the defenceman on the point: twelve pucks, one goalie, and he gets sharper every shot.

**How to play**
1. Hold anywhere (or hold Space) to wind up.
2. Slide your finger (or use the arrow keys) to aim. The Goalie Cam inset shows where the reticle sits on the net.
3. Let go as the puck reaches the white ring. A one-timer catches the goalie moving; a perfect one triggers slow motion and doubles the points.

Some pucks bring a forechecker who closes your shooting lane, so take those as one-timers. Settle the puck first and he'll block it.

**What's in it**
- Rink built to NHL dimensions (metres), with reflective ice, boards, glass, a full crowd, and an LED ribbon board that shows your name when you score.
- Puck physics with posts and crossbar ("PING!"), bar-down detection, rebounds, and a cloth net that bulges on goals. Hit the top of the net and the water bottle flies off.
- A goalie AI that tracks the puck, reacts to the shot, and goes butterfly, glove or blocker depending on where it's headed.
- Synthesized sound with no audio files: slap shot crack, post ping, goal horn, crowd roar.
- Multi-angle slow-motion replays after every goal, and a shot report with a net chart at the end.

It's a single `index.html` using [three.js](https://threejs.org) from a CDN. To run it locally, serve the folder (for example `python3 -m http.server`) and open `/bar-down/`.
