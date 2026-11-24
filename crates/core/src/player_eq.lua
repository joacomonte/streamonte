-- Ecualizador en vivo de Streamonte (lo escribe la app en disco y lo pasa con --script).
-- Las bandas, el headroom y el estado inicial vienen de Rust por --script-opts
-- (player.rs: eq_script_opts); acá solo se arma la misma cadena lavfi que arma Rust y se
-- cambia el filtro "@eq" con las teclas.
--   Alt+Left / Right   preset anterior / siguiente (Cine, Voces claras, Plano); también e / E
--   Alt+Up / Down      intensidad +10 % / -10 % (0–150)
-- Alt (Option en Mac) y no Ctrl: en macOS Ctrl+flechas son de Mission Control y no llegan a mpv.
-- Pisa el Alt+flechas de mpv (mover la imagen).
-- Con streamonte-eq-tip=yes (las primeras reproducciones, lo decide Rust) avisa las teclas al
-- cargar el video.

local ORDER = { 'cine', 'voices', 'flat' }
-- Mismos nombres y notas que Ajustes (ui/src/components/Settings.svelte).
local NAMES = { cine = 'Cine', voices = 'Voces claras', flat = 'Plano' }
local NOTES = {
  cine = 'Graves y voces un poco más presentes.',
  voices = 'Diálogos al frente, graves sin tocar.',
  flat = 'Tal cual viene el video.',
}
-- En Mac la tecla se llama Option.
local MOD = mp.get_property('platform') == 'darwin' and 'Option' or 'Alt'
local MAX_INTENSITY = 150
local STEP = 10

-- Mismo formato de números que config.rs eq_num: dos decimales sin ceros de más.
local function num(x)
  local s = string.format('%.2f', x):gsub('0+$', ''):gsub('%.$', '')
  return s
end

-- "80/0.8/2;3000/1/1.5" -> { {80, 0.8, 2}, ... }
local function parse_bands(text)
  local bands = {}
  for f, w, g in (text or ''):gmatch('([%d%.%-]+)/([%d%.%-]+)/([%d%.%-]+)') do
    bands[#bands + 1] = { tonumber(f), tonumber(w), tonumber(g) }
  end
  return bands
end

local bands = {}
for _, name in ipairs(ORDER) do
  bands[name] = parse_bands(mp.get_opt('streamonte-eq-' .. name))
end
local headroom = tonumber(mp.get_opt('streamonte-eq-headroom')) or 2
local preset = mp.get_opt('streamonte-eq-start') or 'cine'
local intensity = tonumber(mp.get_opt('streamonte-eq-intensity')) or 100

local function chain()
  local list = bands[preset]
  if not list or #list == 0 or intensity <= 0 then return nil end
  local k = intensity / 100
  local parts = { 'volume=-' .. num(headroom * k) .. 'dB' }
  for _, b in ipairs(list) do
    parts[#parts + 1] = 'equalizer=f=' .. num(b[1]) .. ':t=q:w=' .. num(b[2]) .. ':g=' .. num(b[3] * k)
  end
  return table.concat(parts, ',')
end

local function apply()
  -- Sacar "@eq" solo si está (sin él, mpv avisa "label not found" en la consola).
  for _, f in ipairs(mp.get_property_native('af') or {}) do
    if f.label == 'eq' then mp.command_native({ 'af', 'remove', '@eq' }) break end
  end
  local c = chain()
  if c then mp.command_native({ 'af', 'add', '@eq:lavfi=[' .. c .. ']' }) end
  if preset == 'flat' then
    mp.osd_message('Ecualizador: ' .. NAMES.flat .. ' — ' .. NOTES.flat, 3)
  else
    mp.osd_message('Ecualizador: ' .. NAMES[preset] .. ' · ' .. intensity .. '% — ' .. NOTES[preset], 3)
  end
end

local function cycle(dir)
  local at = 1
  for i, name in ipairs(ORDER) do
    if name == preset then at = i end
  end
  preset = ORDER[(at - 1 + dir) % #ORDER + 1]
  apply()
end

local function change_intensity(delta)
  if preset == 'flat' then
    mp.osd_message('Ecualizador: ' .. NAMES.flat .. ' (' .. MOD .. '+←/→ para elegir uno)', 3)
    return
  end
  intensity = math.max(0, math.min(MAX_INTENSITY, intensity + delta))
  apply()
end

mp.add_key_binding('Alt+RIGHT', 'eq-next', function() cycle(1) end)
mp.add_key_binding('Alt+LEFT', 'eq-prev', function() cycle(-1) end)
mp.add_key_binding('e', 'eq-next-e', function() cycle(1) end)
mp.add_key_binding('E', 'eq-prev-e', function() cycle(-1) end)
mp.add_key_binding('Alt+UP', 'eq-intensity-up', function() change_intensity(STEP) end, { repeatable = true })
mp.add_key_binding('Alt+DOWN', 'eq-intensity-down', function() change_intensity(-STEP) end, { repeatable = true })

if mp.get_opt('streamonte-eq-tip') == 'yes' then
  local shown = false
  mp.register_event('file-loaded', function()
    if shown then return end
    shown = true
    mp.osd_message('Ecualizador — ' .. MOD .. '+←/→: tipo · ' .. MOD .. '+↑/↓: intensidad', 4)
  end)
end
