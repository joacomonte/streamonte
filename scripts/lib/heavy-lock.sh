# Lock de tareas pesadas entre worktrees (se usa con `. scripts/lib/heavy-lock.sh`). Interfaz:
#   heavy_lock <etiqueta>   espera hasta tener el lock (imprime "esperando a <pid> (<etiqueta>)" cada 10 s)
#   heavy_unlock            lo suelta (solo si es nuestro)
# El lock es el directorio <git-common-dir>/heavy.lock con `pid` y `label`; un pid muerto cuenta como huérfano y se pisa.
# No instala `trap`: el script que lo usa llama a heavy_unlock en el suyo.
heavy_lock() {
  _hl_dir="$(git rev-parse --git-common-dir)/heavy.lock"
  _hl_n=0
  while ! mkdir "$_hl_dir" 2>/dev/null; do
    _hl_pid=$(cat "$_hl_dir/pid" 2>/dev/null)
    if [ -z "$_hl_pid" ]; then
      # Recién creado y todavía sin pid; si lleva más de un minuto así, quedó roto.
      [ -n "$(find "$_hl_dir" -maxdepth 0 -mmin +1 2>/dev/null)" ] && rm -rf "$_hl_dir"
    elif ! kill -0 "$_hl_pid" 2>/dev/null; then
      rm -rf "$_hl_dir"
      continue
    elif [ $((_hl_n % 10)) = 0 ]; then
      echo "esperando a $_hl_pid ($(cat "$_hl_dir/label" 2>/dev/null))"
    fi
    _hl_n=$((_hl_n + 1))
    sleep 1
  done
  echo $$ >"$_hl_dir/pid"
  echo "$1" >"$_hl_dir/label"
}
heavy_unlock() {
  _hl_dir="$(git rev-parse --git-common-dir 2>/dev/null)/heavy.lock"
  [ "$(cat "$_hl_dir/pid" 2>/dev/null)" = "$$" ] && rm -rf "$_hl_dir"
  return 0
}
