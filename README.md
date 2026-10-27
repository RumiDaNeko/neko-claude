# neko-claude

claude-chan, a 2D chibi desktop companion who lives on your taskbar and reacts to Claude Code.

![claude-chan: idle, walking, working, needs your OK, done, asleep](preview.png)

## Run

Needs Node.js 18+.

```bash
npm install
npm start
```

## Hook her up to Claude Code

```bash
npm run install-hooks:global   # every project (~/.claude/settings.json), recommended
npm run install-hooks          # only when Claude Code runs in this folder (./.claude/settings.local.json)
node install-hooks.mjs --remove [--global]
```

When a Claude Code session starts and she isn't running, the hook launches her (set `CLAUDE_CHAN_AUTOSTART=0` to turn that off). When the last session ends, a tiny **EXIT** door pops up, she waves and backs into it, and the app closes until Claude opens again.

The hooks run `hook.mjs`, which forwards each event to `127.0.0.1:47321` with a 400 ms timeout. The same bridge takes her menu commands too, for scripts and testing: `curl -X POST --data perch http://127.0.0.1:47321/command` (`hello`, `dance`, `trick`, `hide`, `perch`, `kitty`, `treat:cookie`…). If she isn't running, nothing happens and Claude Code is unaffected. Set `CLAUDE_CHAN_PORT` to change the port.

## What she does

| Claude Code | claude-chan |
| --- | --- |
| Session starts | waves hello |
| You send a prompt | sits on her cushion with the laptop, puts on her glasses, thinking bubble |
| A tool runs | types with her eyes on the screen (her Clawd hairclip hops along); the bubble says what: running commands, writing code, reading files… Now and then she glances up at you |
| A tool fails | jolts, sweats and types twice as fast ("Eek! An error!"); a few in a row and she's in tears |
| A failed command passes again | sparkles: "Fixed it! ✨" |
| Needs permission / your input | hops and waves with a red **!** until you answer |
| Finished | cheers with sparkles: "Done! ✨" |
| Session ends | waves bye; after the last one she backs out through the EXIT door |

While Claude works, a thought bubble next to her shows what it's doing with a little animated icon (terminal, book, notepad and pencil, magnifier, spinning globe, a squad of mini Clawds for subagents, a checklist, a gear for anything else), plus the tool count and elapsed time; it turns into a red **?** when Claude needs you and a green ✓ with the totals when it's done. If you're holding her up when Claude changes status she reacts in the air: types on her laptop while dangling, wriggles to be put down when Claude needs you, cheers when it's done. After a run longer than 3 minutes she takes a coffee break. After an hour of coding she holds out a glass of water and tells you to take a break; click her to take it, or she drinks it herself.

When Claude is idle:

- she wanders along the taskbar, turning to a 3/4 view as she walks (keeping whatever face she's making)
- she dances, and every so often does something goofy: trips and faceplants (over a banana peel, a pebble, a stray cable, her own tail… or, classically, nothing at all), does a full 360° twirl, backflips, or sneezes her hairclip off
- after 5 idle minutes she sits on the floor and stares into space; after an hour she drags her cushion over and falls asleep on it
- she follows your cursor around, and if you leave it resting near her feet she crouches, wiggles and pounces on it
- now and then she leaps up onto the title bar of a window and sits there swinging her legs (if Claude starts working she stays up there and works on her laptop) . Drag that window and she clings on, shaking and wide-eyed; carry her upward and she enjoys the elevator ride, but drag it down or sideways and she slips off the moment you let go. Maximise it and it bounces her off; minimise or close it and she drops ("Eh?! It vanished!"). Falling past another window, she lands on it if she was dropping gently, or, if she was falling fast, catches its edge from behind (just her head and hands peeking over the top) and climbs out over it like out of a pool. Toss her at a window and the same happens. Windows only; `CLAUDE_CHAN_PERCH=0` turns it off
- a little grey kitty dashes past sometimes, and she chases it (she never catches it)
- after 23:00 she's in pajamas and a nightcap, yawns more and nods off sooner; the first time Claude opens in the morning she has a coffee
- if she sleeps for half an hour she nods off sideways, tips off her cushion onto the floor (her hair spilling down), and wakes up with a start

**Pat pat:** click her head and the classic petpet hand pats it, her head squishes (her long hair stays put) and hearts pop out; keep patting and she starts purring.

**Expressions:** sparkly star eyes when Claude finishes, a wink when you poke her, flustered >///< then a 💢 pout if you keep poking, and if you still don't stop she hurls her laptop at you and sulks with her back turned (when Claude needs her again she pulls a spare out of her apron pocket) (pokes only make it worse; three head pats make up), surprised when picked up, xx eyes if you hold her up too long, teary >_< after a hard landing, a thinking look when you send a prompt, plus a smug grin, a cat smile, uwu and yawns while idle. Also: heart eyes when you pat her a lot, fired-up brows 🔥 when you send a prompt, a nervous sweat drop when Claude asks permission, a blank shocked stare with gloom lines when you grab her, T_T waterfall tears after a hard landing (or when she remembers her laptop), drowsy eyes while lounging, and her glasses catch the light while she works.

**Hide and seek 🙈** (menu): she runs to a screen edge and hides behind it, or ducks behind the taskbar with just her ears poking up, peeking out now and then and giggling as a hint. Click her to find her (she tells you how long it took); after 90 s she gives up and comes out, and she pops out on her own if Claude needs you.

**Playing with her:** her eyes follow your cursor around the screen. Click a cheek to squish it, double-click for a hop, and wiggle the cursor back and forth over her to tickle her. The **Give her…** menu has a cookie 🍪, coffee ☕ (puts her in glasses mode), boba 🧋, matcha 🍵 and milk 🥛 (milk mustache), held in both hands; any treat ends a sulk. Feed her four treats in ten minutes and she's stuffed: she sits down with a round belly and refuses more for a while (water doesn't count). There's also **Wear glasses**, **Climb onto a window** and **Call the kitty**; the menu toggles are remembered across restarts. Even without that toggle she sometimes puts her glasses on to read for a while, pushing them up with a glint.

Drag her anywhere and let go to toss her (she falls with gravity); grab her mid-air to catch her. Click her body to poke her. Right-click her, or click her tray icon, for the menu (dance, do a trick, nap, toggle wandering, show in taskbar, quit). In the tray and taskbar she goes by **clawde chan**. On Windows 11 the tray icon starts in the hidden-icons overflow (^); drag it onto the taskbar to keep it visible.

The icon lives in `assets/icon.svg`; `npm run build:icon` regenerates `icon.png`, `tray.png` and the multi-size `icon.ico`.

Glasses style: `GLASSES` in `renderer/app.js` (`round`, `half` or `square`).

## Files

- `main.js`: transparent, always-on-top Electron window plus the local event bridge
- `renderer/index.html`: claude-chan, drawn as layered SVG: front, 3/4 and back views, every part animated separately
- `renderer/style.css`: art styling and every pose/animation
- `renderer/app.js`: behavior: wandering, drag/toss physics, tricks, idle timers, Claude status reactions
- `hook.mjs`, `install-hooks.mjs`: the Claude Code side
- `scripts/windows.ps1`: lists the open windows (for perching on title bars); run by `main.js` on Windows

## Credits

Petpet hand frames (`assets/petpet/`) are from [aDu/pet-pet-gif](https://github.com/aDu/pet-pet-gif), ISC license.
