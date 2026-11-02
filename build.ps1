# Package the VSIX and companion skill with the standard-library builder.
# Set LSWB_PYTHON to an exact Python 3 executable path to override detection.
$ErrorActionPreference = 'Stop'
$pythonExe = $env:LSWB_PYTHON
$pythonArguments = @()

if ([string]::IsNullOrWhiteSpace($pythonExe)) {
    $candidates = @()
    if ($env:CONDA_PREFIX) {
        $candidates += Join-Path $env:CONDA_PREFIX 'python.exe'
    }
    if ($env:USERPROFILE) {
        $candidates += Join-Path $env:USERPROFILE 'anaconda3\python.exe'
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $pythonExe = $candidate
            break
        }
    }
    if ([string]::IsNullOrWhiteSpace($pythonExe)) {
        $launcher = Get-Command py.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($launcher) {
            $pythonExe = $launcher.Source
            $pythonArguments = @('-3')
        }
    }
}

if ([string]::IsNullOrWhiteSpace($pythonExe) -or -not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) {
    [Console]::Error.WriteLine('Python 3 was not found. Set LSWB_PYTHON to its full executable path.')
    exit 127
}

& $pythonExe @pythonArguments (Join-Path $PSScriptRoot 'scripts\build.py') @args
exit $LASTEXITCODE
