<!-- Ajustes del desktop: Idioma (SettingsLang se monta en #set-lang-picker) · Reproducción · Conexión · Cuentas · Subtítulos.
     Filas de lista de packages/ui/css/settings.css; cada key muestra su estado y su campo mientras falta. Lógica en settings-model.ts. -->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '$ui/components/Icon.svelte';
  import Sheet from '$ui/components/Sheet.svelte';
  import { desktop } from '../desktopApi.ts';
  import { setStatus, showError } from '../dom.js';
  import { t } from '../i18n.js';
  import {
    installMpv, loadSettings, netCheckView, osLoginText, playersView, saveEqualizer, saveKey, saveLatTeamToken, saveNetwork,
    saveOsLogin, toggleLatTeam, type KeyService, type Net, type PlayersView
  } from '../settings-model.ts';
  import { host } from '../ui-host.ts';
  import type * as Raw from '../types.ts';

  /** `tip`: lo que antes era párrafo, ahora en el tooltip del ⓘ. */
  type Row = { service: KeyService; label: string; hint: string; tip?: string; placeholder: string; primary?: boolean };
  const TMDB: Row = { service: 'tmdb', label: 'TMDB', primary: true, placeholder: 'Pegá la API key (v3)', hint: 'Catálogo con filtros y pósters',
    tip: 'Gratis. Filtrá por fecha, votos, idioma y géneros, con pósters que faltan, idioma original, cadena y similares. Sin key, solo lo que está en tendencia.' };
  const TORBOX: Row = { service: 'torbox', label: 'TorBox', primary: true, placeholder: 'Pegá tu API key de TorBox', hint: 'Ver al instante desde su caché',
    tip: 'Con tu cuenta de TorBox, marca las opciones que ya tiene en su caché: se pueden ver al instante desde sus servidores, sin depender de los seeds.' };
  const WYZIE: Row = { service: 'wyzie', label: 'Wyzie Subs', placeholder: 'Pegá la key', hint: 'Gratis · 1000 por día' };
  const OPENSUBS: Row = { service: 'opensubtitles', label: 'OpenSubtitles.com (Premium)', placeholder: 'Pegá la key', hint: 'Cuenta gratis · 20 por día' };
  const EQ: { id: Raw.Equalizer; label: string; note: string }[] = [
    { id: 'cine', label: 'Cine', note: 'Graves y voces un poco más presentes.' },
    { id: 'voices', label: 'Voces claras', note: 'Diálogos al frente, graves sin tocar.' },
    { id: 'flat', label: 'Plano', note: 'Tal cual viene el video.' }
  ];

  let isOpen = $state(false);
  let keys = $state<Raw.ApiKeyStatus[]>([]);
  let eq = $state<Raw.Equalizer>('cine');
  let eqIntensity = $state(100);
  let net = $state<Net>({ incoming: false, upnp: false, announce: false });
  let latteamOn = $state(false);
  let players = $state<PlayersView | null>(null);
  let osState = $state('');
  let netCheck = $state<{ cls: string; text: string }>({ cls: '', text: '' });
  let netBusy = $state(false);
  let mpvBusy = $state(false);
  let inputs = $state<Record<KeyService, string>>({ tmdb: '', torbox: '', wyzie: '', opensubtitles: '' });
  let latteamToken = $state('');
  let latteamEdit = $state(false);
  let osUser = $state('');
  let osPass = $state('');
  let editing = $state<KeyService[]>([]);
  let saved = $state<{ service: KeyService; text: string } | null>(null);

  const configured = (service: string): boolean => keys.some((k) => k.service === service && k.configured);
  const latteamHas = $derived(configured('latteam'));
  const eqNote = $derived(EQ.find((o) => o.id === eq)?.note ?? '');
  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  function setConfigured(service: string, on: boolean): void {
    keys = keys.some((k) => k.service === service) ? keys.map((k) => (k.service === service ? { ...k, configured: on } : k)) : [...keys, { service, configured: on }];
    editing = editing.filter((s) => s !== service);
  }

  async function showOsLogin(): Promise<void> {
    osState = osLoginText(await desktop.premiumQuota().catch(() => null));
  }

  async function open(): Promise<void> {
    saved = null;
    editing = [];
    latteamEdit = false;
    try {
      showOsLogin();
      const s = await loadSettings(desktop);
      keys = s.keys;
      eq = s.eq;
      eqIntensity = s.eqIntensity;
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

  async function onLatTeamToggle(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    try {
      await toggleLatTeam(desktop, e.currentTarget.checked);
      latteamOn = e.currentTarget.checked;
    } catch (err) {
      showError(err);
    }
  }
  async function onSaveLatTeam(): Promise<void> {
    try {
      const msg = await saveLatTeamToken(desktop, latteamToken);
      latteamToken = '';
      latteamEdit = false;
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

  async function onEqualizer(value: Raw.Equalizer, intensity: number = eqIntensity): Promise<void> {
    try {
      eq = value;
      eqIntensity = intensity;
      setStatus(await saveEqualizer(desktop, value, intensity));
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
  });
</script>

{#snippet chip(id: string, ok: boolean, okText: string, missText: string)}
  <span {id} class="st-chip" class:ok>{#if ok}<Icon name="check" size={12} />{/if}{ok ? okText : missText}</span>
{/snippet}

{#snippet tipIcon(id: string, text: string)}
  <button {id} type="button" class="tip-i" aria-label={text} title={text} onclick={(e) => e.preventDefault()}><Icon name="info" size={14} /></button>
{/snippet}

<!-- Falta: campo a la vista. Guardada: una línea con "Cambiar". Recién guardada: mensaje con tilde 1,8 s. -->
{#snippet keyRow(row: Row)}
  {@const ok = configured(row.service)}
  {@const edit = !ok || editing.includes(row.service)}
  <li class="key-row" data-service={row.service}>
    <div class="st-row">
      <span class="st-lbl">
        <span class="st-name"><label for="key-{row.service}">{t(row.label)}</label>{#if row.tip}{@render tipIcon(`key-${row.service}-tip`, t(row.tip))}{/if}</span>
        <span class="st-sub">{t(row.hint)}</span>
      </span>
      {@render chip(`key-${row.service}-state`, ok, t('Guardada'), t('Falta'))}
      {#if ok}
        <button id="key-{row.service}-change" class="st-link" type="button" onclick={() => toggleEdit(row.service)}>{editing.includes(row.service) ? t('Cancelar') : t('Cambiar')}</button>
      {:else}
        <button id="key-{row.service}-page" class="st-link" type="button" onclick={() => desktop.openKeyPage(row.service).catch(showError)}>{t('Conseguir')}<Icon name="external" size={13} /></button>
      {/if}
    </div>
    {#if saved?.service === row.service}
      <p class="st-block key-done" role="status">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>{saved.text}
      </p>
    {:else if edit}
      <div class="st-block">
        <div class="st-inline">
          <input id="key-{row.service}" class="st-input" type="password" placeholder={t(row.placeholder)} autocomplete="off" bind:value={inputs[row.service]}
            onkeydown={(e) => { if (e.key === 'Enter') onSaveKey(row.service); }}>
          <button id="key-{row.service}-save" class="st-btn" class:go={row.primary} type="button" onclick={() => onSaveKey(row.service)}>{t('Guardar')}</button>
        </div>
      </div>
    {/if}
  </li>
{/snippet}

<Sheet id="dlg-settings" title={t('Ajustes')} titleId="set-title" closeId="btn-settings-x" open={isOpen} onclose={() => (isOpen = false)} maxWidth="min(600px, 92vw)">
  <div class="st">
    <section class="st-sec" id="set-lang" aria-labelledby="set-h-lang">
      <h3 class="st-h" id="set-h-lang">{t('Idioma')}</h3>
      <div id="set-lang-picker"></div>
    </section>

    <section class="st-sec" id="set-player" aria-labelledby="set-h-player">
      <h3 class="st-h" id="set-h-player">{t('Reproducción')}</h3>
      <ul class="st-list">
        <li class="st-row">
          <span class="st-lbl"><span class="st-name">mpv</span><span class="st-sub" id="set-mpv-note">{players?.mpvNote ?? t('Recomendado: anda mejor y gasta menos.')}</span></span>
        </li>
        <li class="st-row">
          <span class="st-lbl"><span class="st-name">VLC</span><span class="st-sub" id="set-vlc-note">{players?.vlcNote ?? t('Sin subtítulos combinados ni ecualizador.')}</span></span>
        </li>
        <li id="set-mpv-missing" class="st-row warn" hidden={!players?.mpvMissing}>
          <span class="st-lbl"><span class="st-sub" id="set-mpv-missing-text">{players?.missingText ?? ''}</span></span>
          <button id="btn-install-mpv" class="st-btn go" type="button" disabled={mpvBusy} onclick={onInstallMpv}>{mpvBusy ? t('Instalando… (unos minutos)') : (players?.installLabel ?? '')}</button>
        </li>
        <li class="st-row">
          <span class="st-lbl"><span class="st-name" id="set-eq-lbl">{t('Sonido (mpv)')}</span><span class="st-sub">{t(eqNote)}</span></span>
          <div class="eq" role="radiogroup" aria-labelledby="set-eq-lbl">
            {#each EQ as o (o.id)}
              <label class="eq-opt" title={t(o.note)}><input id="set-eq-{o.id}" type="radio" name="set-eq" value={o.id} checked={eq === o.id} onchange={() => onEqualizer(o.id)}><span>{t(o.label)}</span></label>
            {/each}
          </div>
        </li>
        <li class="st-row">
          <span class="st-lbl"><label class="st-name" for="eq-intensity">{t('Intensidad')}</label><span class="st-sub" id="eq-keys-help">{t('Durante la reproducción: Option/Alt+←/→ cambia el tipo, Option/Alt+↑/↓ la intensidad')}</span></span>
          <input id="eq-intensity" class="eq-range" type="range" min="0" max="150" step="10" value={eqIntensity} disabled={eq === 'flat'} aria-describedby="eq-keys-help"
            oninput={(e) => (eqIntensity = e.currentTarget.valueAsNumber)} onchange={(e) => onEqualizer(eq, e.currentTarget.valueAsNumber)}>
          <output id="eq-intensity-value" class="eq-pct" for="eq-intensity">{eqIntensity}%</output>
        </li>
        <li>
          <details class="st-more">
            <summary id="set-h-keys" class="st-row">
              <span class="st-lbl"><span class="st-name">{t('Teclas en el reproductor')}</span></span>
              <span class="st-chev"><Icon name="chev" size={18} /></span>
            </summary>
            <div class="st-block">
              <table class="kv keys">
                <tbody>
                  <tr><th>1 – 5</th><td>{t('Dejar solo ese subtítulo')}</td></tr>
                  <tr><th>0</th><td>{t('Ver todos a la vez para comparar')}</td></tr>
                  <tr><th>S</th><td>{t('Ocultar / mostrar subtítulos')}</td></tr>
                  <tr><th>Z / X</th><td>{t('La voz llega antes / después (±0,1 s; con Shift ±1 s)')}</td></tr>
                  <tr><th>R</th><td>{t('Volver la sincronización a cero')}</td></tr>
                  <tr><th>Option/Alt+← / →</th><td>{t('Cambiar el ecualizador')}</td></tr>
                  <tr><th>Option/Alt+↑ / ↓</th><td>{t('Intensidad del ecualizador (±10 %)')}</td></tr>
                </tbody>
              </table>
            </div>
          </details>
        </li>
      </ul>
      <p id="set-player-ask" class="st-foot">{t('Al reproducir te preguntamos con cuál abrirlo.')}</p>
    </section>

    <section class="st-sec" id="set-catalog" aria-labelledby="set-h-net">
      <h3 class="st-h" id="set-h-net">{t('Conexión')}</h3>
      <ul class="st-list">
        <li class="st-row">
          <span class="st-lbl"><span class="st-name">{t('Fuentes de torrents')}</span><span class="st-sub">{t('Addons que se consultan al abrir un título')}</span></span>
          <button id="btn-sources" class="st-btn" type="button">{t('Ver')}</button>
        </li>
        <li>
          <label class="st-row">
            <span class="st-lbl"><span class="st-name">{t('Conexiones entrantes')}</span><span class="st-sub">{t('Suele bajar más rápido')}</span></span>
            <input id="set-incoming" class="st-toggle" type="checkbox" role="switch" checked={net.incoming} onchange={(e) => onNet('incoming', e.currentTarget.checked)}>
          </label>
        </li>
        <li>
          <label class="st-row">
            <span class="st-lbl"><span class="st-name">{t('Abrir el puerto solo (UPnP)')}</span><span class="st-sub">{t('Le pide al router que abra el puerto.')}</span></span>
            <input id="set-upnp" class="st-toggle" type="checkbox" role="switch" checked={net.upnp} disabled={!net.incoming} onchange={(e) => onNet('upnp', e.currentTarget.checked)}>
          </label>
        </li>
        <li>
          <label class="st-row">
            <span class="st-lbl">
              <span class="st-name">{t('Testear al elegir un episodio')}{@render tipIcon('set-announce-tip', t('En series, testea solas las 15 mejores apenas elegís el episodio. Tu IP queda listada ~30 min en esos enjambres.'))}</span>
              <span class="st-sub">{t('Las 15 mejores, solas')}</span>
            </span>
            <input id="set-announce" class="st-toggle" type="checkbox" role="switch" checked={net.announce} disabled={!net.incoming} onchange={(e) => onNet('announce', e.currentTarget.checked)}>
          </label>
        </li>
        <li class="st-row">
          <span class="st-lbl"><span class="st-name">{t('Puerto')}</span><span id="net-check-result" class="st-sub net-check-result {netCheck.cls}" role="status">{netCheck.text}</span></span>
          <button id="btn-net-check" class="st-btn" type="button" disabled={netBusy} onclick={onNetCheck}>{t('Verificar puerto')}</button>
        </li>
        <li>
          <details id="set-net-guide" class="st-more">
            <summary class="st-row">
              <span class="st-lbl"><span class="st-name">{t('¿No abre el puerto?')}</span></span>
              <span class="st-chev"><Icon name="chev" size={18} /></span>
            </summary>
            <div class="st-block">
              <ol class="net-steps">
                <li><b>{t('Probá con UPnP:')}</b> {t('dejá activadas las dos primeras opciones y verificá. Si el router lo soporta, abre el puerto solo. Algunos lo rechazan (por ejemplo, los Sagemcom de los cable-módems).')}</li>
                <li><b>{t('Si da cerrado, abrí el puerto a mano:')}</b> {t('entrá al router (suele ser')} <code>192.168.0.1</code> o <code>192.168.1.1</code>{t('), buscá "Reenvío de puertos", "Port forwarding" o "NAT" y creá una regla: protocolo')} <b>TCP</b>{t(', puerto externo e interno')} <b>41850</b>{t(', hacia la IP de esta PC (la muestra "Verificar"). Conviene reservar esa IP en el DHCP del router para que no cambie.')}</li>
                <li><b>Firewall:</b> {t('en macOS, Ajustes del Sistema › Red › Firewall › Opciones: permití las conexiones entrantes de Streamonte. En Windows, aceptá el aviso del firewall la primera vez.')}</li>
                <li><b>{t('Si aun así da cerrado:')}</b> {t('tu proveedor puede usar CGNAT (sin IP pública propia). Pedile una IP pública; sin eso no se pueden recibir entrantes.')}</li>
              </ol>
              <p>{t('Aplica desde la próxima reproducción; si el router lo bloquea, todo sigue andando con conexiones salientes. "Verificar" abre el puerto un momento y le pide a portchecker.io que intente conectarse a tu IP pública (que averigua con api.ipify.org).')}</p>
            </div>
          </details>
        </li>
      </ul>
    </section>

    <section class="st-sec" id="set-accounts" aria-labelledby="set-h-accounts">
      <h3 class="st-h" id="set-h-accounts">{t('Cuentas y keys')}</h3>
      <ul class="st-list">
        {@render keyRow(TMDB)}
        {@render keyRow(TORBOX)}
        <li id="set-latteam">
          <div class="st-row">
            <span class="st-lbl">
              <span class="st-name"><label for="set-latteam-on">Lat-Team</label>{@render tipIcon('latteam-tip', t('Tracker privado con audio latino. El API token está en tu perfil de Lat-Team → Ajustes → Seguridad. Tiene reglas de ratio: reproducir desde ahí con el motor de la app puede no estar permitido. Con TorBox no hace ratio.'))}</span>
              <span class="st-sub">{t('Tracker privado con audio latino')}</span>
            </span>
            {@render chip('latteam-state', latteamHas, t('Guardado'), t('Falta'))}
            {#if latteamHas}
              <button id="key-latteam-change" class="st-link" type="button" onclick={() => (latteamEdit = !latteamEdit)}>{latteamEdit ? t('Cancelar') : t('Cambiar')}</button>
            {:else}
              <button id="key-latteam-page" class="st-link" type="button" onclick={() => desktop.openKeyPage('latteam').catch(showError)}>{t('Conseguir')}<Icon name="external" size={13} /></button>
            {/if}
            <input id="set-latteam-on" class="st-toggle" type="checkbox" role="switch" aria-label={t('Buscar también en Lat-Team')} checked={latteamOn} onchange={onLatTeamToggle}>
          </div>
          {#if !latteamHas || latteamEdit}
            <div class="st-block">
              <div class="st-inline">
                <input id="key-latteam" class="st-input" type="password" placeholder={t('Pegá tu API token de Lat-Team')} autocomplete="off" aria-label={t('Pegá tu API token de Lat-Team')} bind:value={latteamToken}
                  onkeydown={(e) => { if (e.key === 'Enter') onSaveLatTeam(); }}>
                <button id="key-latteam-save" class="st-btn" type="button" onclick={onSaveLatTeam}>{t('Guardar')}</button>
              </div>
            </div>
          {/if}
        </li>
      </ul>
      <p class="st-foot lock"><Icon name="lock" size={12} />{t('En el almacén seguro del sistema; nunca se muestran')}</p>
    </section>

    <section class="st-sec" id="set-subs" aria-labelledby="set-h-subs">
      <h3 class="st-h" id="set-h-subs">{t('Subtítulos')}</h3>
      <ul class="st-list">
        {@render keyRow(WYZIE)}
        {@render keyRow(OPENSUBS)}
        <li id="os-login">
          <div class="st-row">
            <span class="st-lbl">
              <span class="st-name">{t('Cuenta de OpenSubtitles.com')}{@render tipIcon('os-login-tip', t('Opcional: con tu cuenta de OpenSubtitles.com se ve cuántas descargas te quedan desde que abrís la app y se baja con la cuota de tu cuenta. Se guarda en el almacén seguro.'))}</span>
              <span id="os-login-state" class="st-sub" role="status">{osState}</span>
            </span>
          </div>
          <div class="st-block">
            <div class="st-inline">
              <input id="os-user" class="st-input" type="text" placeholder={t('Usuario')} autocomplete="username" aria-label={t('Usuario de OpenSubtitles.com')} bind:value={osUser}>
              <input id="os-pass" class="st-input" type="password" placeholder={t('Contraseña')} autocomplete="current-password" aria-label={t('Contraseña de OpenSubtitles.com')} bind:value={osPass}>
              <button id="os-login-save" class="st-btn" type="button" onclick={onSaveOs}>{t('Guardar')}</button>
            </div>
          </div>
        </li>
      </ul>
    </section>
  </div>
  {#snippet footer()}
    <footer class="set-foot">
      <button id="btn-settings-close" class="st-btn" type="button" onclick={() => (isOpen = false)}>{t('Cerrar')}</button>
    </footer>
  {/snippet}
</Sheet>

<style>
  .st { padding: 6px 4px 8px; }
  .st-name label { cursor: inherit; }
  .tip-i { display: inline-flex; padding: 0; border: 0; background: none; color: var(--muted); cursor: help; border-radius: 50%; }
  .tip-i:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
  .lock { display: inline-flex; align-items: center; gap: 5px; }
  .warn { background: color-mix(in srgb, var(--yellow) 10%, transparent); }
  .warn .st-sub { color: var(--text); }
  /* Sonido: tres opciones en un segmentado chico; la nota de la elegida va debajo del nombre. */
  .eq { display: inline-grid; grid-auto-flow: column; padding: 3px; border-radius: var(--r-pill); background: var(--surface-3); }
  .eq-range { flex: none; width: 150px; accent-color: var(--accent); }
  .eq-range:disabled { opacity: 0.45; }
  .eq-pct { flex: none; min-width: 3.2em; text-align: right; font-size: 13px; font-weight: 650; color: var(--muted); font-variant-numeric: tabular-nums; }
  .eq-opt { position: relative; cursor: pointer; }
  .eq-opt input { position: absolute; opacity: 0; pointer-events: none; }
  .eq-opt span { display: block; padding: 6px 12px; border-radius: var(--r-pill); color: var(--muted); font-size: 13px; font-weight: 650; white-space: nowrap; transition: background 0.2s var(--ease), color 0.2s var(--ease); }
  .eq-opt input:checked + span { background: var(--accent); color: var(--accent-text); box-shadow: 0 3px 10px -4px color-mix(in srgb, var(--accent) var(--tint-4), transparent); }
  .eq-opt input:focus-visible + span { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
  .key-done { flex-direction: row; align-items: center; gap: 10px; margin: 0; color: var(--text); font-size: 13px; font-weight: 600; animation: set-pop 0.35s var(--out); }
  .key-done svg { flex: none; color: var(--green); }
  .key-done :global(svg circle) { stroke-dasharray: 64; stroke-dashoffset: 64; animation: set-draw 0.45s var(--out) forwards; }
  .key-done :global(svg path) { stroke-dasharray: 16; stroke-dashoffset: 16; animation: set-draw 0.3s var(--out) 0.35s forwards; }
  @keyframes set-draw { to { stroke-dashoffset: 0; } }
  @keyframes set-pop { from { opacity: 0; transform: scale(0.98); } }
  .net-check-result.ok { color: var(--green); }
  .net-check-result.bad { color: var(--red); }
  .net-steps { margin: 0; padding-left: 18px; display: grid; gap: 6px; font-size: 12.5px; color: var(--text); }
  .net-steps code { font-family: var(--mono); font-size: 12px; }
  .st-more p { margin: 0; }
  .keys th { width: 90px; font-family: ui-monospace, monospace; }
  @media (prefers-reduced-motion: reduce) { .key-done, .key-done :global(svg *) { animation: none; stroke-dashoffset: 0; } .eq-opt span { transition: none; } }
</style>
