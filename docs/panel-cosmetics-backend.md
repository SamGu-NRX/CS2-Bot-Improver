# Panel backend: player cosmetics commands

The Panel's Presets page has a Cosmetics section (`Panel/src/panels/CosmeticsSection.tsx`). It sets three BotRandomizer server convars for the human player. The frontend calls two Tauri commands that `src-tauri` does not have yet. This document specifies them.

Until they exist, the frontend catches Tauri's `Command get_player_cosmetics not found` rejection. It shows the section disabled with "Not available in this Panel version" and stops polling that command. Every other section keeps working.

## Plugin dependency

The convars come from two BotRandomizer branches that are not in the submodule commit this repo pins (`1c7c3eb`):

| Convar | Type | Meaning | Branch |
| --- | --- | --- | --- |
| `br_dropped_knife_skins` | bool, default 0 | Random finish on knives spawned by `subclass_create`; vanilla is one outcome | `feat/dropped-knife-finishes` |
| `br_dropped_knife_premium` | bool, default 0 | Favor expensive finishes on those knives; ignored while skins are off | `feat/dropped-knife-finishes` |
| `br_player_music_kit` | int, default 0 | 0 = off, -1 = one random kit per map, >0 = music kit definition ID | `feat/player-music-kit` |

All three are CounterStrikeSharp `FakeConVar`s, not fields of `BotRandomizer.json`. Against an older plugin, the cfg lines below print "Unknown command" in the console and do nothing, so merge the plugin branches first.

## Commands

```rust
#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct PlayerCosmetics {
    pub dropped_knife_skins: bool,
    pub dropped_knife_premium: bool,
    pub music_kit: i32,
}

#[derive(Serialize)]
pub struct PlayerCosmeticsState {
    #[serde(flatten)]
    pub cosmetics: PlayerCosmetics,
    pub cfg_present: bool,  // the target cfg exists
    pub cs2_running: bool,  // same detection the other commands use
}

#[tauri::command]
fn get_player_cosmetics(csgo: String) -> Result<PlayerCosmeticsState, AppError>;

#[tauri::command]
fn set_player_cosmetics(csgo: String, cosmetics: PlayerCosmetics) -> Result<PlayerCosmeticsState, AppError>;
```

The frontend invokes them as `invoke("get_player_cosmetics", { csgo })` and `invoke("set_player_cosmetics", { csgo, cosmetics })` (`Panel/src/lib/api.ts`). `set` always receives all three values. The store serializes writes, so `set` never runs concurrently with itself. `set` returns the state as read back from disk after the write, like `set_drop_knives`.

Register both in `generate_handler!`.

## Which file to write

### Recommended: a managed block in `cfg/my_bot_normal_config.cfg`

This is the file that holds the Drop Knives bind (`cfg/my_bot_normal_config.cfg:64`). Four gamemode cfgs run it on map load: `gamemode_competitive.cfg:116`, `gamemode_competitive2v2.cfg:115`, `gamemode_competitive_offline.cfg:5` and `gamemode_competitive2v2_offline.cfg:5`. One write covers Competitive and Wingman, hosted and offline.

On `set`, remove every line in the file that sets one of the three convars. Then append:

```
// CS2 Bot Improver Panel: player cosmetics. The Panel rewrites these lines.
br_dropped_knife_skins 1
br_dropped_knife_premium 0
br_player_music_kit 33
```

Always write all three lines, including zeros. A FakeConVar keeps its value across map changes in one CS2 session. Deleting the line would therefore leave the old value active rather than reset it.

Trade-offs:

- Mod releases ship this file, so reinstalling the mod resets the block. If the backend stores the values in `AppConfig` (for example `player_cosmetics`), it can rewrite the block on boot, the way `reconcile_core_json` runs today. The frontend does not read that field.
- `gamemode_competitive_server.cfg` runs after this file. Any `br_` line a user put there overrides the Panel's value. The Panel can't see that, so the README should tell users who set these by hand to delete those lines.

### Alternative: `cfg/gamemode_competitive_server.cfg`

Neither Valve nor the mod ships this file, so updates don't touch it, and it runs last. The costs: the Panel would edit a file users write by hand, so it must preserve every other line. Wingman needs a second file (`gamemode_competitive2v2_server.cfg`). I have not checked which `_server.cfg`, if any, CS2 runs for the offline variants.

### Not recommended: `BotRandomizer.json`

The convars are not config properties, so this needs a plugin change first. CounterStrikeSharp reads the JSON only when the plugin loads. A change would then need a CS2 restart instead of the next map, and the Panel's next-map messaging would be wrong.

## Reading the current values

Parse the same file. For each convar, take the last uncommented line of the form `br_name <value>`, because the game applies the last one. Booleans accept `0`/`1` and `true`/`false`. If a line is missing or unparsable, use the plugin default (`false`, `false`, `0`). If the file itself is missing, return `cfg_present: false` with defaults. The frontend then shows the section red and disabled, like the other sections.

## When CS2 is running

Write anyway. CS2 does not lock the cfg. Return `cs2_running: true`. The frontend then turns the section's light yellow and shows the toast `cos.nextMap` ("Saved — applies on next map load"), the same pattern as the Difficulty card. The value applies when the cfg next runs on map load. The light stays yellow until CS2 closes, because the Panel can't observe map loads.

To apply a change right away, the user can type the convar in the console. `br_player_music_kit` re-applies on change. The knife convars are read on each knife spawn.

## Validation in `set_player_cosmetics`

- `music_kit` must be `0`, `-1`, or an ID in the `musicKits` array of `addons/counterstrikesharp/plugins/BotRandomizer/cosmetic_catalog.json`. Upstream's catalog already has `musicKits`; the names only exist on the music-kit branch. Reject anything else with an `AppError`; don't write. The plugin would ignore an unknown ID with a log warning, which the user would never see.
- If the catalog is missing or unreadable, return an `AppError` rather than writing an unchecked ID.
- Accept `dropped_knife_premium: true` while skins are off. The UI disables the toggle but keeps its value, and the plugin ignores it.

The frontend's kit list is `Panel/src/data/musicKits.ts`. `Panel/scripts/gen-music-kits.mjs` generates it from a catalog that has `musicKitNames`. Regenerate it when Valve adds kits; otherwise the backend will accept a new ID that the picker lists only as `#<id>`.

## Checks before release

1. Older `ui.exe` without the commands: the Cosmetics section is disabled with the note, and the other sections work.
2. `set` with CS2 closed, then start a bot match. In the console, `br_player_music_kit` prints the saved value on the first map, which confirms the plugin registered the convar before the cfg ran.
3. `set` with CS2 running: yellow light, next-map toast, value active after `changelevel`.
4. `set` with `music_kit: 9999` returns an error and leaves the file unchanged.
5. A hand-written `br_player_music_kit 5` above the block is removed on the next `set`.
