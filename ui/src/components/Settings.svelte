<!-- Ajustes del desktop como tablero ($ui/settings/board/Board.svelte): fichas Llaves · Perfil · Reproducción · Conexión · Idioma;
     cada una abre en su lugar un panel con las filas de siempre (packages/ui/css/settings.css + board.css). Lógica en settings-model.ts. -->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '$ui/components/Icon.svelte';
  import Sheet from '$ui/components/Sheet.svelte';
  import { confirmDialog } from '$ui/components/confirm-queue.ts';
  import MyAnimals from '$ui/animals/MyAnimals.svelte';
  import Idioma from '$ui/settings/Idioma.svelte';
  import KeyField from '$ui/settings/KeyField.svelte';
  import { createKeysForm } from '$ui/settings/keys-form.svelte.ts';
  import Section from '$ui/settings/Section.svelte';
  import Board, { type BoardTile } from '$ui/settings/board/Board.svelte';
  import AnimalFan from '$ui/settings/board/art/AnimalFan.svelte';
  import EqArt from '$ui/settings/board/art/EqArt.svelte';
  import KeysArt from '$ui/settings/board/art/KeysArt.svelte';
  import LangArt from '$ui/settings/board/art/LangArt.svelte';
  import NetArt, { type NetState } from '$ui/settings/board/art/NetArt.svelte';
  import Plate from '$ui/settings/board/art/Plate.svelte';
  import { COMMON_KEYS } from '$ui/settings/keys.ts';
  import * as core from '../core.ts';
  import { setStatus, showError } from '../dom.ts';
  import { langs, setLangs, t } from '../i18n.ts';
  import {
    installMpv, loadSettings, netCheckView, osLoginText, playersView, saveEqualizer, saveKey, saveLatTeamToken, saveNetwork,
    saveOsLogin, toggleLatTeam, type KeyService, type Net, type PlayersView
  } from '../settings-model.ts';
  import { nickApiOf, nickState, refreshNick } from '../nick-state.svelte.ts';
  import { host } from '../ui-host.ts';
  import type * as Raw from '../types.ts';

  /** `tip`: lo que antes era párrafo, ahora en el tooltip del ⓘ. Las tres keys comunes salen de `$ui/settings/keys.ts`. */
  type Row = { service: KeyService; label: string; hint: string; tip?: string; placeholder: string; primary?: boolean };
  const TIPS: Partial<Record<KeyService, string>> = {
    tmdb: 'Gratis. Filtrá por fecha, votos, idioma y géneros, con pósters que faltan, idioma original, cadena y similares. Sin key, solo lo que está en tendencia.',
    torbox: 'Con tu cuenta de TorBox, marca las opciones que ya tiene en su caché: se pueden ver al instante desde sus servidores, sin depender de los seeds.',
    opensubtitles: 'Para "Buscar en Premium" en los subtítulos: cuenta gratis, 20 descargas por día.'
  };
  const NAMES: Record<string, string> = { tmdb: 'la key de TMDB', torbox: 'la key de TorBox', opensubtitles: 'la key de OpenSubtitles.com', wyzie: 'la key de Wyzie Subs' };
  const COMMON: Row[] = COMMON_KEYS.map((k) => ({ service: k.service, label: k.name, hint: k.hint, tip: TIPS[k.service], placeholder: k.placeholder, primary: k.service !== 'opensubtitles' }));
  const WYZIE: Row = { service: 'wyzie', label: 'Wyzie Subs', placeholder: 'Pegá la key', hint: 'Gratis · 1000 por día' };
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
  let latteamToken = $state('');
  let latteamEdit = $state(false);
  let osUser = $state('');
  let osPass = $state('');
  let switching = $state(false);
  let nickMsg = $state('');
  let osLogged = $state(false);

  const configured = (service: string): boolean => keys.some((k) => k.service === service && k.configured);
  const latteamHas = $derived(configured('latteam'));
  const eqNote = $derived(EQ.find((o) => o.id === eq)?.note ?? '');
  const eqLabel = $derived(EQ.find((o) => o.id === eq)?.label ?? '');

  /** Llaves del tablero, en el orden del panel; la cuenta de OpenSubtitles cuenta como una más. */
  const KEY_CHIPS: { id: string; short: string }[] = [
    { id: 'tmdb', short: 'TMDB' }, { id: 'torbox', short: 'TorBox' }, { id: 'opensubtitles', short: 'OpenSubs' },
    { id: 'os-login', short: 'Cuenta OS' }, { id: 'latteam', short: 'Lat-Team' }, { id: 'wyzie', short: 'Wyzie' }
  ];
  const keysOn = $derived(KEY_CHIPS.map((k) => (k.id === 'os-login' ? osLogged : configured(k.id))));
  const keysCount = $derived(keysOn.filter(Boolean).length);
  const netState = $derived<NetState>(netBusy ? 'busy' : netCheck.cls === 'ok' || netCheck.cls === 'bad' ? netCheck.cls : net.incoming ? 'idle' : 'off');
  const netChip = $derived(netBusy ? { cls: '', text: t('Verificando…') } : netCheck.cls === 'ok' ? { cls: 'ok', text: t('Abierto') } : netCheck.cls === 'bad' ? { cls: 'bad', text: t('Cerrado') } : { cls: '', text: t('Sin verificar') });

  // Los summary/art/panel son snippets del template (abajo): oxlint no los ve.
  /* oxlint-disable no-undef */
  const tiles: BoardTile[] = $derived([
    { id: 'keys', label: t('Llaves'), title: t('Llaves y cuentas'), icon: 'key', summary: keysSum, art: keysArt, panel: keysPanel,
      hero: t('{n} de {m} guardadas. Ninguna es obligatoria: cada una suma algo.', { n: keysCount, m: KEY_CHIPS.length }) },
    { id: 'profile', label: t('Perfil'), icon: 'user', summary: profileSum, art: profileArt, panel: profilePanel,
      hero: t('{nick}. Tu clave para entrar son estos 2 animales.', { nick: nickState.nick ?? '' }) },
    { id: 'repro', label: t('Reproducción'), icon: 'speaker', summary: reproSum, art: reproArt, panel: reproPanel,
      hero: `${t(eqLabel)}${eq === 'flat' ? '' : ` · ${eqIntensity}%`}. ${t('Al reproducir te preguntamos con cuál abrirlo.')}` },
    { id: 'net', label: t('Conexión'), icon: 'wifi', summary: netSum, art: netArt, panel: netPanel,
      hero: netCheck.text || t('Puerto 41850. Probá si alguien de afuera llega a esta PC.') },
    { id: 'lang', label: t('Idioma'), icon: 'globe', summary: langSum, art: langArt, panel: langPanel, hero: t('La app y los títulos van por separado.') }
  ]);
  /* oxlint-enable no-undef */

  function setConfigured(service: string, on: boolean): void {
    keys = keys.some((k) => k.service === service) ? keys.map((k) => (k.service === service ? { ...k, configured: on } : k)) : [...keys, { service, configured: on }];
  }

  /** Guardado por key con `saveKey` (settings-model.ts); el formulario compartido pone el estado y la confirmación. */
  const keysForm = createKeysForm({
    status: () => Object.fromEntries(keys.map((k) => [k.service, k.configured])),
    set: async (service, value) => {
      const r = await saveKey(core, service, value);
      if (r.event) document.dispatchEvent(new CustomEvent(r.event));
      setConfigured(service, true);
      setStatus(r.status);
      return r.done;
    },
    remove: async (service) => {
      const ok = await confirmDialog(t('Borrar'), t('¿Borrar {x}?', { x: t(NAMES[service] ?? service) }), [
        { id: 'confirm-cancel', label: t('Cancelar'), value: false },
        { id: 'confirm-ok', label: t('Borrar'), value: true, primary: true, danger: true }
      ]);
      if (!ok) return false;
      const r = await saveKey(core, service, '');
      if (r.event) document.dispatchEvent(new CustomEvent(r.event));
      setConfigured(service, false);
      setStatus(r.status);
    }
  });

  async function showOsLogin(): Promise<void> {
    const q = await core.premiumQuota().catch(() => null);
    osLogged = !!q?.has_login && !q.login_error;
    osState = osLoginText(q);
  }

  /** Cambiar de usuario: cierra la sesión del apodo; la bienvenida (`Welcome.svelte`) vuelve a pedirlo sola al quedar sin apodo. */
  async function onSwitchUser(): Promise<void> {
    switching = true;
    nickMsg = '';
    try {
      await nickApiOf().logout();
      await refreshNick();
    } catch {
      nickMsg = t('No se pudo guardar. Probá de nuevo.');
    } finally {
      switching = false;
    }
  }

  let board = $state<Board>();

  async function open(tile?: string): Promise<void> {
    keysForm.reset();
    void refreshNick();
    latteamEdit = false;
    try {
      showOsLogin();
      const s = await loadSettings(core);
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
    if (tile) {
      await tick();
      await board?.open(tile);
    }
  }

  async function onLatTeamToggle(e: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    try {
      await toggleLatTeam(core, e.currentTarget.checked);
      latteamOn = e.currentTarget.checked;
    } catch (err) {
      showError(err);
    }
  }
  async function onSaveLatTeam(): Promise<void> {
    try {
      const msg = await saveLatTeamToken(core, latteamToken);
      latteamToken = '';
      latteamEdit = false;
      keys = await core.apiKeys();
      setStatus(msg);
    } catch (e) {
      showError(e);
    }
  }
  async function onSaveOs(): Promise<void> {
    try {
      await saveOsLogin(core, osUser, osPass);
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
      setStatus(await saveEqualizer(core, value, intensity));
    } catch (e) {
      showError(e);
    }
  }
  async function onNet(field: keyof Net, value: boolean): Promise<void> {
    net = { ...net, [field]: value };
    try {
      setStatus(await saveNetwork(core, net));
    } catch (e) {
      showError(e);
    }
  }

  async function onInstallMpv(): Promise<void> {
    mpvBusy = true;
    try {
      setStatus(await installMpv(core));
    } catch (e) {
      showError(e);
    } finally {
      mpvBusy = false;
      core.playersStatus().then((p) => (players = playersView(p)), () => {});
    }
  }

  async function onNetCheck(): Promise<void> {
    netBusy = true;
    netCheck = { cls: '', text: t('Abriendo el puerto en el router y probando desde internet (hasta 30 s)…') };
    try {
      netCheck = netCheckView(await core.checkIncoming());
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

<!-- Cada key: KeyField de $ui/settings (campo mientras falta, "Cambiar" si está, confirmación 1,8 s). -->
{#snippet keyRow(row: Row)}
  <KeyField form={keysForm} service={row.service} name={t(row.label)} hint={t(row.hint)} tip={row.tip && t(row.tip)} placeholder={row.placeholder} primary={row.primary} onget={() => core.openKeyPage(row.service).catch(showError)} />
{/snippet}

<!-- Fichas del tablero: estado de un vistazo (summary), ilustración del panel (art) y las filas de siempre (panel). -->
{#snippet keysSum()}
  <span class="board-b row stack">
    <span class="keys-art"><KeysArt on={keysOn} /></span>
    <span class="b-i"><span class="b-big">{keysCount}<small>{' ' + t('de {m} guardadas', { m: KEY_CHIPS.length })}</small></span>
      <span class="b-chips">{#each KEY_CHIPS as k, i (k.id)}<span id="board-key-{k.id}" class="b-chip" class:on={keysOn[i]}><i></i>{k.id === 'os-login' ? t('Cuenta OS') : k.short}</span>{/each}</span></span>
  </span>
{/snippet}
{#snippet keysArt()}<KeysArt on={keysOn} />{/snippet}
{#snippet keysPanel()}
    <Section id="set-accounts" headId="set-h-accounts" level={3} title={t('Cuentas y keys')}>
      <ul class="st-list">
        {#each COMMON as row (row.service)}{@render keyRow(row)}{/each}
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
              <button id="key-latteam-page" class="st-link" type="button" onclick={() => core.openKeyPage('latteam').catch(showError)}>{t('Conseguir')}<Icon name="external" size={13} /></button>
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
        {@render keyRow(WYZIE)}
      </ul>
      <p class="st-foot lock"><Icon name="lock" size={12} />{t('En el almacén seguro del sistema; nunca se muestran')}</p>
    </Section>
{/snippet}

{#snippet profileSum()}
  <span class="board-b"><span class="b-i"><span class="b-big nick-big">{nickState.nick ?? ''}</span><span class="b-sub">{t('Tu clave: estos 2')}</span></span>
    {#if nickState.animals}<AnimalFan animals={nickState.animals} />{/if}</span>
{/snippet}
{#snippet profileArt()}{#if nickState.animals}<AnimalFan animals={nickState.animals} />{:else}<Icon name="user" size={56} />{/if}{/snippet}
{#snippet profilePanel()}
    <Section id="set-profile" headId="set-h-profile" level={3} title={t('Perfil')}>
      <div class="nick-card">
        <span class="nick-ava" aria-hidden="true">{(nickState.nick ?? '?').slice(0, 1).toUpperCase()}</span>
        <span class="nick-txt"><span class="nick-lbl">{t('Apodo')}</span><b id="nick-current">{nickState.nick ?? ''}</b></span>
        <button id="nick-change-user" class="st-btn" type="button" disabled={switching || !nickState.nick} onclick={onSwitchUser}>{t('Cambiar de usuario')}</button>
      </div>
      <p id="nick-msg" class="st-msg st-foot bad" role="status">{nickMsg}</p>
      {#if nickState.animals}
        <MyAnimals animals={nickState.animals} />
      {:else if nickState.nick}
        <p id="my-animals" class="st-msg st-foot">{t('Entrá de nuevo con tus animales para verlos acá')}</p>
      {/if}
    </Section>
{/snippet}

{#snippet reproSum()}
  <span class="board-b">
    <span class="b-i"><span class="b-big">{t(eqLabel)}</span><span class="b-sub">{eq === 'flat' ? t('Tal cual viene el video.') : t('Intensidad {n}%', { n: eqIntensity })}</span></span>
    <span class="b-well"><EqArt {eq} intensity={eqIntensity} /><span class="eq-bands"><span>{t('graves')}</span><span>{t('voces')}</span><span>{t('agudos')}</span></span></span>
    <span class="b-row">{#if players?.mpvMissing}<span class="b-stt warn">{t('Falta mpv')}</span>{:else}<span class="b-stt ok"><Icon name="check" size={12} />mpv</span>{/if}<span class="b-sub">{t('VLC de alternativa')}</span></span>
  </span>
{/snippet}
{#snippet reproArt()}<EqArt {eq} intensity={eqIntensity} />{/snippet}
{#snippet reproPanel()}
    <Section id="set-player" headId="set-h-player" level={3} title={t('Reproducción')}>
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
    </Section>
{/snippet}

{#snippet netSum()}
  <span class="board-b">
    <span class="b-i"><span class="b-row"><span class="b-big mono">41850</span><span class="b-stt {netChip.cls}">{netChip.text}</span></span>
      <span class="b-sub">{net.incoming ? (net.upnp ? t('Entrantes · UPnP abre el puerto solo') : t('Entrantes')) : t('Solo salientes')}</span></span>
    <NetArt state={netState} />
  </span>
{/snippet}
{#snippet netArt()}<NetArt state={netState} />{/snippet}
{#snippet netPanel()}
    <Section id="set-catalog" headId="set-h-net" level={3} title={t('Conexión')}>
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
    </Section>
{/snippet}

{#snippet langSum()}
  <span class="board-b row stack">
    <span class="lang-art"><LangArt /></span>
    <span class="b-i"><Plate titles={langs.titles} /><span class="b-sub">{t('Así se ven los títulos')}</span>
      <span class="b-row"><span class="b-stt">{t('App: {x}', { x: langs.app === 'en' ? 'English' : 'Español' })}</span></span></span>
  </span>
{/snippet}
{#snippet langArt()}<LangArt />{/snippet}
{#snippet langPanel()}
    <Idioma id="set-lang" headId="set-h-lang" pickerId="set-lang" level={3} app={langs.app} titles={langs.titles} onpick={(key, value) => langs[key] !== value && setLangs({ [key]: value })} />
{/snippet}

<Sheet id="dlg-settings" class="frost" title={t('Ajustes')} titleId="set-title" closeId="btn-settings-x" open={isOpen} onclose={() => (isOpen = false)} maxWidth="min(800px, 94vw)">
  <Board bind:this={board} {tiles} areas="'keys keys profile' 'repro net profile' 'repro lang lang'" areasNarrow="'keys keys' 'profile profile' 'repro repro' 'net net' 'lang lang'" />
  {#snippet footer()}
    <footer class="set-foot">
      <button id="btn-settings-close" class="st-btn" type="button" onclick={() => (isOpen = false)}>{t('Cerrar')}</button>
    </footer>
  {/snippet}
</Sheet>

<style>
  .keys-art { flex: none; width: 36%; max-width: 200px; }
  .lang-art { flex: none; width: 42%; max-width: 120px; }
  .nick-big { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @container board (max-width: 560px) { .keys-art { width: 60%; align-self: center; } .lang-art { width: 100%; max-width: none; height: 64px; } }
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
  .net-check-result.ok { color: var(--green); }
  .net-check-result.bad { color: var(--red); }
  .net-steps { margin: 0; padding-left: 18px; display: grid; gap: 6px; font-size: 12.5px; color: var(--text); }
  .net-steps code { font-family: var(--mono); font-size: 12px; }
  .st-more p { margin: 0; }
  .keys th { width: 90px; font-family: ui-monospace, monospace; }
  @media (prefers-reduced-motion: reduce) { .eq-opt span { transition: none; } }
</style>
