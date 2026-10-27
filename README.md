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

The hooks run `hook.mjs`, which forwards each event to `127.0.0.1:47321` with a 400 ms timeout. If she isn't running, nothing happens and Claude Code is unaffected. Set `CLAUDE_CHAN_PORT` to change the port.

## What she does

| Claude Code | claude-chan |
| --- | --- |
| Session starts | waves hello |
| You send a prompt | sits on her cushion with the laptop, puts on her glasses, thinking bubble |
| A tool runs | types with her eyes on the screen (her Clawd hairclip hops along); the bubble says what: running commands, writing code, reading files… Now and then she glances up at you |
| Needs permission / your input | hops and waves with a red **!** until you answer |
| Finished | cheers with sparkles: "Done! ✨" |
| Session ends | waves bye; after the last one she backs out through the EXIT door |

When Claude is idle:

- she wanders along the taskbar, turning to a 3/4 view as she walks (keeping whatever face she's making)
- she dances, and every so often does something goofy: trips and faceplants, does a full 360° twirl, backflips, or sneezes her hairclip off
- after 5 idle minutes she sits on the floor and stares into space; after an hour she drags her cushion over and falls asleep on it
- if she sleeps for half an hour she nods off sideways, tips off her cushion onto the floor (her hair spilling down), and wakes up with a start

**Pat pat:** click her head and the classic petpet hand pats it, her head squishes (her long hair stays put) and hearts pop out; keep patting and she starts purring.

**Expressions:** sparkly star eyes when Claude finishes, a wink when you poke her, flustered >///< then a 💢 pout if you keep poking, and if you still don't stop she hurls her laptop at you and sulks with her back turned (pokes only make it worse; three head pats make up), surprised when picked up, xx eyes if you hold her up too long, teary >_< after a hard landing, a thinking look when you send a prompt, plus a smug grin, a cat smile and yawns while idle.

Drag her anywhere and let go to toss her (she falls with gravity). Click her body to poke her. Right-click her, or click her tray icon, for the menu (dance, do a trick, nap, toggle wandering, show in taskbar, quit). In the tray and taskbar she goes by **clawde chan**. On Windows 11 the tray icon starts in the hidden-icons overflow (^); drag it onto the taskbar to keep it visible.

The icon lives in `assets/icon.svg`; `npm run build:icon` regenerates `icon.png`, `tray.png` and the multi-size `icon.ico`.

Glasses style: `GLASSES` in `renderer/app.js` (`round`, `half` or `square`).

## Files

- `main.js`: transparent, always-on-top Electron window plus the local event bridge
- `renderer/index.html`: claude-chan, drawn as layered SVG: front, 3/4 and back views, every part animated separately
- `renderer/style.css`: art styling and every pose/animation
- `renderer/app.js`: behavior: wandering, drag/toss physics, tricks, idle timers, Claude status reactions
- `hook.mjs`, `install-hooks.mjs`: the Claude Code side

## Credits

Petpet hand frames (`assets/petpet/`) are from [aDu/pet-pet-gif](https://github.com/aDu/pet-pet-gif), ISC license.
