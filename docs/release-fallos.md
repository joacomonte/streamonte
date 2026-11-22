# Fallos de release

## Intento 1: tag v2.0.0 (run release 45072095352), 2026-11-22
- Síntoma: los 3 builds del job `build` fallaron en ~1 min, en el paso de tauri-action. `beforeBuildCommand` (`cd ui && corepack pnpm install ... && corepack pnpm build`) no encontraba `ui`.
- Causa raíz: el CLI de Tauri ejecuta `beforeBuildCommand` en un cwd que elige él (no la raíz del repo), así que `cd ui` no existía.
- Arreglo (commit ee3ff71): se quitó `beforeBuildCommand` de /Users/monti/Documents/Dev/streamonte/src-tauri/tauri.conf.json y se agregó en /Users/monti/Documents/Dev/streamonte/.github/workflows/release.yml un paso explícito `npm i -g pnpm@10.34.9 && cd ui && pnpm install --frozen-lockfile && pnpm build` (bash) antes de tauri-action. Se usó `npm i -g pnpm` en vez de `corepack enable` para no depender de corepack en windows-latest.
- Cómo detectarlo antes del tag: correr el mismo build que el workflow (ver propuesta).

## Intento 2: tag v2.0.0 recreado sobre ee3ff71 (run release 45072824420), 2026-11-22
- Resultado: OK. create-release, 3 builds (windows, mac arm, mac intel) y publish en success. Release v2.0.0 publicado (no draft) con dmg/app.tar.gz+.sig (arm y x64), setup.exe+.sig y latest.json.

## Lo que "volvió a fallar" en los mismos commits: job `ci` / `visual` (NO es el release)
- Runs: ci main 45072809190 y ci v2.0.0 45072824373 (los tags v* también disparan ci.yml). Fallan solo en el job `visual`; core (mac/windows), shared-ui, web y ui pasaron.
- Síntoma: `FALLA app-home-desktop-light.png 0.128 %`, `app-ficha-fight-club-desktop-light.png 0.726 %`, `app-temporadas-breaking-bad-desktop-light.png 0.301 %`, `app-ajustes-desktop-light.png 0.115 %`, y luego `page.waitForSelector: Timeout 30000ms exceeded` esperando `a[href^="/t/"] img` (/Users/monti/Documents/Dev/streamonte/scripts/visual.mjs:85).
- Causa probable (hipótesis, no confirmada): baselines grabadas en el Mac del dev difieren (<1 %) del render en el runner; y el selector del paso de web depende de imágenes de red (posters) que no cargan a tiempo en CI. Se necesitaría descargar el artifact `visual-diffs` para confirmar.
- Arreglo: pendiente, no tocado (los archivos de web/ los trabaja otro agente y las baselines tocan UI compartida).

## Propuesta de prevención (no implementada, a confirmar)
1. Job `release-check` en /Users/monti/Documents/Dev/streamonte/.github/workflows/ci.yml, en PRs y push a main, que corra exactamente los pasos del release (fetch-mpv, build de ui con pnpm, `tauri build --no-bundle` o `--bundles app` sin firmar en macos-latest y windows-latest). Habría atrapado el intento 1.
2. Script local `scripts/release-check.sh`: `cd ui && pnpm install --frozen-lockfile && pnpm build` + `cargo build --release -p streamonte`, para correr antes de taggear.
3. Evitar que los tags `v*` disparen `ci.yml` con jobs flaky (o hacer que `visual` no corra en tags), y que el visual tolere diferencias de runner (umbral ~1 % o baselines generadas en CI) y no dependa de red para posters (mock de imágenes).
4. Regla: no taggear hasta que ci de main esté verde (excepto visual conocido) y release-check pase.
