<!-- Ajustes del desktop: idioma (lo arma lang-picker.js en #set-lang-picker), keys, Lat-Team, subtítulos, reproductor, red y teclas.
     Las keys sin configurar van en su sección; las configuradas pasan a "Conectado", al final. Lógica en settings-model.ts. -->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import Sheet from '$ui/components/Sheet.svelte';
  import { desktop } from '../desktopApi.ts';
  import { setStatus, showError } from '../dom.js';
  import { t } from '../i18n.js';
  import {
    installMpv, loadSettings, netCheckView, osLoginText, playersView, saveEqualizer, saveKey, saveLatTeamToken, saveNetwork,
    saveOsLogin, saveTorboxCode, setTorboxShared, toggleLatTeam, type KeyService, type Net, type PlayersView
  } from '../settings-model.ts';
  import { host } from '../ui-host.ts';
  import type * as Raw from '../types.js';

  type Row = { service: KeyService; label: string; hint?: string; placeholder: string; page: string; primary?: boolean };
  const TMDB: Row = { service: 'tmdb', label: 'TMDB', primary: true, placeholder: 'Pegá la API key (v3)', page: '¿No tenés? Pedila gratis (cuenta → Ajustes → API)',
    hint: 'Gratis. Filtrá por fecha, votos, idioma y géneros, con pósters que faltan, idioma original, cadena y similares. Sin key, solo lo que está en tendencia.' };
  const TORBOX: Row = { service: 'torbox', label: 'TorBox', primary: true, placeholder: 'Pegá tu API key de TorBox', page: '¿Dónde está? En tu cuenta de TorBox → Settings → API',
    hint: 'Con tu cuenta de TorBox, marca las opciones que ya tiene en su caché: se pueden ver al instante desde sus servidores, sin depender de los seeds.' };
  const WYZIE: Row = { service: 'wyzie', label: 'Wyzie Subs', placeholder: 'Pegá la key', page: 'Pedir key (solo email, 1000/día)' };
  const OPENSUBS: Row = { service: 'opensubtitles', label: 'OpenSubtitles.com (Premium)', placeholder: 'Pegá la key', page: 'Crear key (cuenta gratis, 20 descargas/día)' };
  const ROWS: Row[] = [TMDB, TORBOX, WYZIE, OPENSUBS];
  const EQ: { id: Raw.Equalizer; label: string; note: string; path: string }[] = [
    { id: 'cine', label: 'Cine', note: 'Graves y voces un poco más presentes.', path: 'M0 18 C8 18 10 9 18 9 S30 17 40 18 S60 19 70 14 S82 11 88 15 S100 15 108 13 S116 12 120 13' },
    { id: 'voices', label: 'Voces claras', note: 'Diálogos al frente, graves sin tocar.', path: 'M0 18 C20 18 40 18 50 16 S62 8 72 8 S84 13 92 17 S110 18 120 18' },
    { id: 'flat', label: 'Plano', note: 'Tal cual viene el video.', path: 'M0 18 H120' }
  ];

  let isOpen = $state(false);
  let keys = $state<Raw.ApiKeyStatus[]>([]);
  let shared = $state(false);
  let eq = $state<Raw.Equalizer>('cine');
  let net = $state<Net>({ incoming: false, upnp: false, announce: false });
  let latteamOn = $state(false);
  let players = $state<PlayersView | null>(null);
  let osState = $state('');
  let codeError = $state('');
  let netCheck = $state<{ cls: string; text: string }>({ cls: '', text: '' });
  let netBusy = $state(false);
  let mpvBusy = $state(false);
  let inputs = $state<Record<KeyService, string>>({ tmdb: '', torbox: '', wyzie: '', opensubtitles: '' });
  let latteamToken = $state('');
  let torboxCode = $state('');
  let osUser = $state('');
  let osPass = $state('');
  let editing = $state<KeyService[]>([]);
  let saved = $state<{ service: KeyService; text: string } | null>(null);
  /** La fila que baja a "Conectado" entra con una animación (no al abrir el diálogo). */
  let flyIn = $state(false);

  const configured = (service: string): boolean => keys.some((k) => k.service === service && k.configured);
  const torboxUsable = $derived(configured('torbox'));
  const latteamHas = $derived(configured('latteam'));
  /** Keys conectadas, en el orden en que las devuelve el núcleo; la de TorBox propia no se ve con el código compartido. */
  const connected = $derived(keys.flatMap((k) => ROWS.filter((r) => r.service === k.service && k.configured && !(r.service === 'torbox' && shared))));
  const motion = (): boolean => !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  function setConfigured(service: string, on: boolean): void {
    keys = keys.some((k) => k.service === service) ? keys.map((k) => (k.service === service ? { ...k, configured: on } : k)) : [...keys, { service, configured: on }];
    editing = editing.filter((s) => s !== service);
  }

  async function showOsLogin(): Promise<void> {
    osState = osLoginText(await desktop.premiumQuota().catch(() => null));
  }

  async function open(): Promise<void> {
    flyIn = false;
    saved = null;
    editing = [];
    try {
      showOsLogin();
      const s = await loadSettings(desktop);
      keys = s.keys;
      shared = s.shared;
      eq = s.eq;
      net = s.net;
      latteamOn = s.latteamOn;
      players = playersView(s.players);
    } catch (e) {
      showError(e);
    }
    isOpen = true;
  }

  async function onSaveKey(service: KeyService): Promise<void> {
    try {
      const r = await saveKey(desktop, service, inputs[service]);
      inputs[service] = '';
      if (r.event) document.dispatchEvent(new CustomEvent(r.event));
      if (r.cleared) {
        setConfigured(service, false);
        setStatus(r.status);
        return;
      }
      saved = { service, text: r.done };
      setStatus(r.status);
      await wait(1800);
      flyIn = motion();
      saved = null;
      setConfigured(service, true);
    } catch (e) {
      showError(e);
    }
  }

  async function toggleEdit(service: KeyService): Promise<void> {
    editing = editing.includes(service) ? editing.filter((s) => s !== service) : [...editing, service];
    await tick();
    if (editing.includes(service)) document.getElementById(`key-${service}`)?.focus();
  }

  async function onShared(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const on = e.currentTarget.checked;
    try {
      await setTorboxShared(desktop, on);
      codeError = '';
      shared = on;
      keys = await desktop.apiKeys();
      document.dispatchEvent(new CustomEvent('streamonte:torbox-key'));
    } catch (err) {
      e.currentTarget.checked = shared;
      showError(err);
    }
  }

  /** Si la web rechaza el código, se borra y se vuelve a pedir acá. */
  async function onSaveCode(): Promise<void> {
    try {
      const r = await saveTorboxCode(desktop, torboxCode);
      if (r.error !== null) {
        codeError = r.error;
        return;
      }
      torboxCode = '';
      codeError = '';
      shared = true;
      keys = await desktop.apiKeys();
      document.dispatchEvent(new CustomEvent('streamonte:torbox-key'));
      setStatus(r.status);
    } catch (e) {
      showError(e);
    }
  }

  async function onLatTeamToggle(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    try {
      await toggleLatTeam(desktop, e.currentTarget.checked);
    } catch (err) {
      showError(err);
    }
  }
  async function onSaveLatTeam(): Promise<void> {
    try {
      const msg = await saveLatTeamToken(desktop, latteamToken);
      latteamToken = '';
      keys = await desktop.apiKeys();
      setStatus(msg);
    } catch (e) {
      showError(e);
    }
  }
  async function onSaveOs(): Promise<void> {
    try {
      await saveOsLogin(desktop, osUser, osPass);
      osPass = '';
      await showOsLogin();
    } catch (e) {
      showError(e);
    }
  }

  async function onEqualizer(value: Raw.Equalizer): Promise<void> {
    try {
      eq = value;
      setStatus(await saveEqualizer(desktop, value));
    } catch (e) {
      showError(e);
    }
  }
  async function onNet(field: keyof Net, value: boolean): Promise<void> {
    net = { ...net, [field]: value };
    try {
      setStatus(await saveNetwork(desktop, net));
    } catch (e) {
      showError(e);
    }
  }

  async function onInstallMpv(): Promise<void> {
    mpvBusy = true;
    try {
      setStatus(await installMpv(desktop));
    } catch (e) {
      showError(e);
    } finally {
      mpvBusy = false;
      desktop.playersStatus().then((p) => (players = playersView(p)), () => {});
    }
  }

  async function onNetCheck(): Promise<void> {
    netBusy = true;
    netCheck = { cls: '', text: t('Abriendo el puerto en el router y probando desde internet (hasta 30 s)…') };
    try {
      netCheck = netCheckView(await desktop.checkIncoming());
    } catch (e) {
      showError(e);
      netCheck = { cls: '', text: '' };
    } finally {
      netBusy = false;
    }
  }

  onMount(() => {
    host.openSettings = open;
    const onWrongCode = async (): Promise<void> => {
      if (!isOpen) await open();
      codeError = t('Código incorrecto');
      document.getElementById('key-torbox-code')?.focus();
    };
    document.addEventListener('streamonte:torbox-code', onWrongCode);
    return () => document.removeEventListener('streamonte:torbox-code', onWrongCode);
  });
</script>

{#snippet keyRow(row: Row)}
  {@const ok = configured(row.service)}
  <div class="key-row" class:editing={editing.includes(row.service)} class:saved={saved?.service === row.service} data-service={row.service}
    in:fly={{ y: -6, duration: flyIn ? 320 : 0 }}>
    <div class="key-head">
      <label for="key-{row.service}">{t(row.label)}</label><span id="key-{row.service}-state" class="key-state" class:ok>{ok ? t('✔ conectada') : t('sin configurar')}</span>
      <button id="key-{row.service}-change" class="key-change" type="button" onclick={() => toggleEdit(row.service)}>{t('Cambiar')}</button>
    </div>
    <div class="key-edit">
      {#if row.hint}<p class="hint">{t(row.hint)}</p>{/if}
      <div class="key-line">
        <input id="key-{row.service}" type="password" placeholder={t(row.placeholder)} autocomplete="off" bind:value={inputs[row.service]}>
        <button id="key-{row.service}-save" class:primary={row.primary} onclick={() => onSaveKey(row.service)}>{t('Guardar')}</button>
      </div>
      <button id="key-{row.service}-page" class="link" onclick={() => desktop.openKeyPage(row.service).catch(showError)}>{t(row.page)}</button>
    </div>
    <p class="key-done" role="status">
      {#if saved?.service === row.service}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>{saved.text}
      {/if}
    </p>
  </div>
{/snippet}

<Sheet id="dlg-settings" title={t('Ajustes')} titleId="set-title" closeId="btn-settings-x" open={isOpen} onclose={() => (isOpen = false)} maxWidth="min(640px, 92vw)">
    <section class="set-card" id="set-lang" aria-labelledby="set-h-lang">
      <h4 id="set-h-lang">{t('Idioma')}</h4>
      <div id="set-lang-picker"></div>
    </section>

    <section class="set-card" id="set-catalog" aria-labelledby="set-h-catalog">
      <h4 id="set-h-catalog">{t('Catálogo')}</h4>
      {#if !configured('tmdb')}{@render keyRow(TMDB)}{/if}
      <div id="torbox-shared">
        <label class="set-line"><input id="set-torbox-shared" type="checkbox" checked={shared} onchange={onShared}> {t('Usar TorBox de Streamonte')} <span id="torbox-code-state" class="key-state" class:ok={torboxUsable} hidden={!shared}>{torboxUsable ? t('✔ código guardado') : t('falta el código')}</span></label>
        <p class="hint">{t('Usa la cuenta de TorBox de Streamonte: pide el código de acceso (el mismo de la web) una sola vez. Apagalo para usar tu propia key.')}</p>
        <div id="torbox-code-line" class="key-line" hidden={!shared}>
          <input id="key-torbox-code" type="password" inputmode="numeric" maxlength="3" placeholder={t('Código de 3 dígitos')} autocomplete="off" bind:value={torboxCode}
            onkeydown={(e) => { if (e.key === 'Enter') onSaveCode(); }}>
          <button id="key-torbox-code-save" type="button" onclick={onSaveCode}>{t('Guardar')}</button>
        </div>
        <p id="torbox-code-error" class="hint" role="alert">{codeError}</p>
      </div>
      {#if !shared && !configured('torbox')}{@render keyRow(TORBOX)}{/if}
      <div class="set-line">
        <p class="hint">{t('Fuentes de torrents: los addons que se consultan al abrir una película o episodio.')}</p>
        <button id="btn-sources">{t('Ver y activar fuentes')}</button>
      </div>
    </section>

    <section class="set-card" id="set-latteam" aria-labelledby="set-h-latteam">
      <h4 id="set-h-latteam">Lat-Team</h4>
      <label class="set-line"><input id="set-latteam-on" type="checkbox" checked={latteamOn} onchange={onLatTeamToggle}> {t('Buscar también en Lat-Team')} <span id="latteam-state" class="key-state" class:ok={latteamHas}>{latteamHas ? t('✔ token guardado') : t('sin token')}</span></label>
      <p class="hint">{t('Tracker privado con audio latino. El API token está en tu perfil de Lat-Team → Ajustes → Seguridad. Tiene reglas de ratio: reproducir desde ahí con el motor de la app puede no estar permitido. Con TorBox no hace ratio.')}</p>
      <div class="key-line">
        <input id="key-latteam" type="password" placeholder={t('Pegá tu API token de Lat-Team')} autocomplete="off" bind:value={latteamToken}>
        <button id="key-latteam-save" type="button" onclick={onSaveLatTeam}>{t('Guardar')}</button>
      </div>
      <button id="key-latteam-page" class="link" onclick={() => desktop.openKeyPage('latteam').catch(showError)}>{t('Abrir Lat-Team')}</button>
    </section>

    <section class="set-card keys-only" id="set-subs" aria-labelledby="set-h-subs">
      <h4 id="set-h-subs">{t('Subtítulos')}</h4>
      <p class="hint">{t('Se bajan hasta 5 en español, primero los que trae el torrent. Para buscar más hacen falta estas keys gratuitas.')}</p>
      {#each [WYZIE, OPENSUBS] as row (row.service)}
        {#if !configured(row.service)}{@render keyRow(row)}{/if}
      {/each}
      <div class="os-login" id="os-login">
        <p class="hint">{t('Opcional: con tu cuenta de OpenSubtitles.com se ve cuántas descargas te quedan desde que abrís la app y se baja con la cuota de tu cuenta. Se guarda en el almacén seguro.')}</p>
        <div class="key-line">
          <input id="os-user" type="text" placeholder={t('Usuario')} autocomplete="username" aria-label={t('Usuario de OpenSubtitles.com')} bind:value={osUser}>
          <input id="os-pass" type="password" placeholder={t('Contraseña')} autocomplete="current-password" aria-label={t('Contraseña de OpenSubtitles.com')} bind:value={osPass}>
          <button id="os-login-save" type="button" onclick={onSaveOs}>{t('Guardar')}</button>
        </div>
        <p id="os-login-state" class="hint" role="status">{osState}</p>
      </div>
    </section>

    <section class="set-card" aria-labelledby="set-h-player">
      <h4 id="set-h-player">{t('Reproductor')}</h4>
      <div class="set-eq" aria-label={t('Reproductores')}>
        <div class="set-eq-opt set-player-opt"><span><b>mpv</b><small id="set-mpv-note">{players?.mpvNote ?? t('Recomendado: anda mejor y gasta menos.')}</small></span></div>
        <div class="set-eq-opt set-player-opt"><span><b>VLC</b><small id="set-vlc-note">{players?.vlcNote ?? t('Sin subtítulos combinados ni ecualizador.')}</small></span></div>
      </div>
      <small id="set-player-ask" class="set-player-ask">{t('Al reproducir te preguntamos con cuál abrirlo.')}</small>
      <div id="set-mpv-missing" class="set-mpv-missing" hidden={!players?.mpvMissing}>
        <span id="set-mpv-missing-text">{players?.missingText ?? ''}</span>
        <button id="btn-install-mpv" disabled={mpvBusy} onclick={onInstallMpv}>{mpvBusy ? t('Instalando… (unos minutos)') : (players?.installLabel ?? '')}</button>
      </div>
      <h5 class="set-sub">{t('Sonido (mpv)')}</h5>
      <div class="set-eq" role="radiogroup" aria-label={t('Sonido')}>
        {#each EQ as o (o.id)}
          <label class="set-eq-opt"><input id="set-eq-{o.id}" type="radio" name="set-eq" value={o.id} checked={eq === o.id} onchange={() => onEqualizer(o.id)}><span><svg class="set-eq-curve" viewBox="0 0 120 36" aria-hidden="true"><path class="grid" d="M0 18H120"/><path class="line" d={o.path}/></svg><b>{t(o.label)}</b><small>{t(o.note)}</small></span></label>
        {/each}
      </div>
    </section>

    <section class="set-card" aria-labelledby="set-h-net">
      <h4 id="set-h-net">{t('Red')}</h4>
      <label class="switch set-switch"><input id="set-incoming" type="checkbox" role="switch" checked={net.incoming} onchange={(e) => onNet('incoming', e.currentTarget.checked)}><span><b>{t('Conexiones entrantes')}</b><small>{t('Más peers pueden mandarte pedazos: suele bajar más rápido.')}</small></span></label>
      <label class="switch set-switch"><input id="set-upnp" type="checkbox" role="switch" checked={net.upnp} disabled={!net.incoming} onchange={(e) => onNet('upnp', e.currentTarget.checked)}><span><b>{t('Abrir el puerto solo (UPnP)')}</b><small>{t('Le pide al router que abra el puerto.')}</small></span></label>
      <label class="switch set-switch"><input id="set-announce" type="checkbox" role="switch" checked={net.announce} disabled={!net.incoming} onchange={(e) => onNet('announce', e.currentTarget.checked)}><span><b>{t('Testear al elegir un episodio')}</b><small>{t('En series, testea solas las 15 mejores apenas elegís el episodio. Tu IP queda listada ~30 min en esos enjambres.')}</small></span></label>
      <div class="net-check">
        <button id="btn-net-check" disabled={netBusy} onclick={onNetCheck}>{t('Verificar puerto')}</button>
        <span id="net-check-result" class="net-check-result {netCheck.cls}" role="status">{netCheck.text}</span>
      </div>
      <details id="set-net-guide" class="net-guide">
        <summary>{t('¿No abre el puerto?')}</summary>
        <ol class="net-steps">
          <li><b>{t('Probá con UPnP:')}</b> {t('dejá activadas las dos primeras opciones y verificá. Si el router lo soporta, abre el puerto solo. Algunos lo rechazan (por ejemplo, los Sagemcom de los cable-módems).')}</li>
          <li><b>{t('Si da cerrado, abrí el puerto a mano:')}</b> {t('entrá al router (suele ser')} <code>192.168.0.1</code> o <code>192.168.1.1</code>{t('), buscá "Reenvío de puertos", "Port forwarding" o "NAT" y creá una regla: protocolo')} <b>TCP</b>{t(', puerto externo e interno')} <b>41850</b>{t(', hacia la IP de esta PC (la muestra "Verificar"). Conviene reservar esa IP en el DHCP del router para que no cambie.')}</li>
          <li><b>Firewall:</b> {t('en macOS, Ajustes del Sistema › Red › Firewall › Opciones: permití las conexiones entrantes de Streamonte. En Windows, aceptá el aviso del firewall la primera vez.')}</li>
          <li><b>{t('Si aun así da cerrado:')}</b> {t('tu proveedor puede usar CGNAT (sin IP pública propia). Pedile una IP pública; sin eso no se pueden recibir entrantes.')}</li>
        </ol>
        <p class="hint">{t('Aplica desde la próxima reproducción; si el router lo bloquea, todo sigue andando con conexiones salientes. "Verificar" abre el puerto un momento y le pide a portchecker.io que intente conectarse a tu IP pública (que averigua con api.ipify.org).')}</p>
      </details>
    </section>

    <section class="set-card" aria-labelledby="set-h-keys">
      <h4 id="set-h-keys">{t('Teclas en el reproductor')}</h4>
      <table class="kv keys">
        <tbody>
          <tr><th>1 – 5</th><td>{t('Dejar solo ese subtítulo')}</td></tr>
          <tr><th>0</th><td>{t('Ver todos a la vez para comparar')}</td></tr>
          <tr><th>S</th><td>{t('Ocultar / mostrar subtítulos')}</td></tr>
          <tr><th>Z / X</th><td>{t('La voz llega antes / después (±0,1 s; con Shift ±1 s)')}</td></tr>
          <tr><th>R</th><td>{t('Volver la sincronización a cero')}</td></tr>
        </tbody>
      </table>
    </section>

    <section class="set-card set-connected" id="set-connected" aria-labelledby="set-h-connected">
      <h4 id="set-h-connected">{t('Conectado')}</h4>
      {#each connected as row (row.service)}{@render keyRow(row)}{/each}
    </section>
  {#snippet footer()}
    <footer class="set-foot">
      <span class="hint">{t('Las keys se guardan en el almacén seguro del sistema y nunca se muestran.')}</span>
      <button id="btn-settings-close" onclick={() => (isOpen = false)}>{t('Cerrar')}</button>
    </footer>
  {/snippet}
</Sheet>
