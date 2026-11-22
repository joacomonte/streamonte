# Instala las herramientas para compilar Streamonte en Windows (winget, fuentes oficiales).
# Rust (rustup, toolchain MSVC) + Build Tools de C++ de Visual Studio + Git + Node 24 (UI con Vite/npm).
# Idempotente: si algo ya esta instalado, winget lo informa y sigue.
# Archivo en ASCII a proposito: PowerShell 5.1 lee mal UTF-8 sin BOM (leccion 8).

$ErrorActionPreference = 'Continue'

function Step($name, [scriptblock]$action) {
    Write-Host ""
    Write-Host "=== ${name} ===" -ForegroundColor Cyan
    & $action
    Write-Host "=== ${name}: salida ${LASTEXITCODE} ===" -ForegroundColor Cyan
}

$common = @('--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements')

Step 'Build Tools de C++ (linker MSVC, ~2-3 GB, puede tardar)' {
    winget install --id Microsoft.VisualStudio.2022.BuildTools @common --override '--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
}

Step 'Rust (rustup)' {
    winget install --id Rustlang.Rustup @common
}

Step 'Git' {
    winget install --id Git.Git @common
}

Step 'Node 24' {
    winget install --id OpenJS.NodeJS --version 24.21.0 @common
}

# PATH nuevo en esta misma consola.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

Step 'Toolchain stable MSVC' {
    rustup default stable-x86_64-pc-windows-msvc
    rustup component add clippy rustfmt
}

Write-Host ""
Write-Host "=== Verificacion ===" -ForegroundColor Green
rustc --version
cargo --version
git --version
node --version
Write-Host 'LISTO' -ForegroundColor Green
