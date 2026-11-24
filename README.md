# Streamonte

**Buscás una película o serie, elegís la mejor opción y en segundos la estás viendo.**
Sin cuentas, sin publicidad y sin pelearte con magnets: Streamonte busca en varias fuentes a la
vez, te dice cuál va a andar mejor en tu conexión y la reproduce por streaming mientras baja.

Hecha con un núcleo en **Rust**: nativa, liviana y rápida.

[⬇ Descargar la última versión](https://github.com/joacomonte/streamonte/releases/latest) · macOS (Apple Silicon e Intel) · Windows

---

## Por qué está buena

### Elegís bien antes de darle play
- **Busca en varias fuentes a la vez** y junta todas las opciones de cada película o episodio,
  agrupadas por resolución (4K, 1080p, 720p).
- **Seeders chequeados de verdad**: al cargar las opciones consulta los trackers solos, y con
  **"Chequear 4K"** (o la resolución que tengas abierta) se conecta a los mejores candidatos y cuenta los seeders reales, todos
  a la vez. La que mejor pinta queda marcada como **Mejor opción**.
- **Salud estimada del stream**: un indicador (bueno / justo / malo) de si esa opción alcanza
  para verla sin cortes en *tu* conexión. Se calibra solo con lo que vas viendo.
- Badges que importan: **LAT** (audio latino), **HDR** y **Pesado** (cuando el archivo pide más
  de lo que suele bancar una conexión común).
- **Cargar en background**: dejás bajando una opción sin abrir el reproductor y te dice si la
  velocidad real alcanza para verla ("2,3× · alcanza").

### Le das play y arranca
- **Streaming real**: empieza a reproducir mientras baja, priorizando el principio del video.
  Si una fuente viene lenta, no te deja esperando: abre el reproductor igual.
- **Reproduce con mpv**: el reproductor más sólido que hay, con todos los formatos (4K, HDR,
  Dolby Vision, cualquier audio).
- **Subtítulos en español automáticos**: busca y baja hasta 5 de varias fuentes *mientras* se
  prepara el video, así ya están cuando arranca. Cambiás entre ellos con las teclas 1–5 y los
  comparás todos a la vez con 0.
- **Retomás donde dejaste**: lo que pausás queda guardado y sigue desde el mismo minuto, aunque
  cierres la app.

### No te ensucia la PC
- Solo ocupa en disco lo que de verdad bajó (nada de archivos gigantes llenos de ceros).
- Lo analizado se borra solo, y en la barra de arriba ves cuánto ocupa la caché y la borrás con
  un toque.

### Y lo demás
- **Pegados**: copiás un magnet y aparece en la app listo para reproducir.
- **Actividad y logs**: abajo ves qué está haciendo en cada momento, con un panel de logs
  filtrable y descargable.
- **Red sin vueltas**: en Ajustes hay una guía para abrir el puerto del router (UPnP o a mano)
  y un botón para verificar si quedó abierto. Con el puerto abierto entran más peers y baja
  más rápido.
- **Se actualiza sola**: cuando sale una versión nueva, la app te avisa y se instala con un clic.

---

## Hecha en Rust

Streamonte no es una página web disfrazada de app:

- **Núcleo 100 % Rust**: el motor de torrents (librqbit) corre adentro de la app, sin procesos
  aparte ni Node. La interfaz usa la vista web del sistema (Tauri), no un Chrome entero
  empaquetado.
- **Liviana**: el instalador de macOS pesa **10 MB**, el de Windows **3,7 MB**, y la app
  instalada ocupa **21 MB**.
- **Hace mucho a la vez sin trabarse**: cuenta los seeders de 15 torrents en paralelo, baja
  subtítulos de varias fuentes y prepara el video al mismo tiempo.

---

## Instalación

1. Bajá el instalador de la [última versión](https://github.com/joacomonte/streamonte/releases/latest):
   - **macOS**: el `.dmg` de tu chip (`aarch64` = Apple Silicon, `x64` = Intel). La primera vez macOS la bloquea
     porque no está firmada por Apple: andá a **Ajustes del Sistema › Privacidad y seguridad**
     y tocá **"Abrir igualmente"**.
   - **Windows**: el `-setup.exe`. Si aparece SmartScreen, "Más información" › "Ejecutar de
     todas formas".
2. El reproductor (**mpv**) ya viene incluido (macOS 15 o más nuevo, y Windows). En un macOS más
   viejo, instalalo desde **Ajustes › Reproductor › Instalar mpv** (o con `brew install mpv`); si
   tenés **VLC**, mientras tanto se usa ese.

> Streamonte es una herramienta para reproducir torrents. Usala con contenido que tengas
> derecho a ver.

---

## Para desarrolladores

### Estructura
```
streamonte/
├─ crates/core/     núcleo en Rust (sin Tauri): catálogo, análisis, reproducción, subtítulos, limpieza
├─ src-tauri/       cáscara Tauri: ventana, comandos 1:1 con el núcleo, eventos
├─ ui/              UI Svelte + TS con Vite; ui/src/core.ts espeja los comandos
├─ engines/         sidecar webtorrent (Node, opcional; no va en el instalador)
└─ .github/         CI (fmt, clippy, tests) y release (Mac + Windows)
```

### Compilar
Requisitos: [Rust](https://rustup.rs), y para el instalador la CLI de Tauri vía npm.

```
cargo test -p streamonte-core      # pruebas del núcleo
cargo run -p streamonte            # app en desarrollo (UI estática en ui/)
npx @tauri-apps/cli@2 icon src-tauri/icons/app-icon.png   # regenerar íconos
```

En Windows hay un script que instala todo con winget:
`powershell -ExecutionPolicy Bypass -File .\scripts\install-toolchain.ps1`

### Release
1. Subir `version` en `src-tauri/tauri.conf.json` y en `[workspace.package]` de `Cargo.toml`.
2. Commit, y `git tag vX.Y.Z && git push origin main vX.Y.Z`.
3. El workflow `release` compila Mac (dmg universal) y Windows (`-setup.exe`), escribe
   `latest.json` (lo consultan las apps instaladas para actualizarse) y publica el release.

La clave de firma del updater vive fuera del repo y en el secreto `TAURI_SIGNING_PRIVATE_KEY`.
Si se pierde, las apps instaladas no pueden actualizarse solas: hay que reinstalar a mano.
