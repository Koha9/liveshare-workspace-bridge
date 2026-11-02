#!/bin/sh
# Package from any working directory; forward all arguments to scripts/build.py.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        # Reuse Windows interpreter detection and preserve existing execution policy.
        exec powershell.exe -NoLogo -NoProfile -NonInteractive -File "$(cygpath -w "$script_dir/build.ps1")" "$@"
        ;;
esac

if [ -n "${LSWB_PYTHON:-}" ]; then
    python_exe=$LSWB_PYTHON
elif [ -n "${CONDA_PREFIX:-}" ] && [ -x "$CONDA_PREFIX/bin/python" ]; then
    python_exe=$CONDA_PREFIX/bin/python
elif command -v python3 >/dev/null 2>&1; then
    python_exe=$(command -v python3)
else
    printf '%s\n' 'Python 3 was not found. Set LSWB_PYTHON to its full executable path.' >&2
    exit 127
fi

exec "$python_exe" "$script_dir/scripts/build.py" "$@"
