@echo off
setlocal
set "PATH=%~dp0;%PATH%"
set "npm_config_verify_deps_before_run=false"
if exist "%~dp0.env" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0.env") do (
    if "%%A"=="DSH_APP_ROOT" set "DSH_APP_ROOT=%%B"
  )
)
if "%1"=="dsh" (
  shift
  if defined DSH_APP_ROOT (
    if exist "%DSH_APP_ROOT%\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" (
      "%DSH_APP_ROOT%\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" "%~dp0scripts\dsh-runner.mjs" %1 %2 %3 %4 %5 %6 %7 %8 %9
      exit /b %ERRORLEVEL%
    )
  )
  node "%~dp0scripts\dsh-runner.mjs" %1 %2 %3 %4 %5 %6 %7 %8 %9
  exit /b %ERRORLEVEL%
)
if "%1"=="test" (
  node "%~dp0scripts\self-test.mjs"
  exit /b %ERRORLEVEL%
)
if defined DSH_APP_ROOT (
  if exist "%DSH_APP_ROOT%\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" (
    if exist "%DSH_APP_ROOT%\resources\runtime\pnpm\bin\pnpm.cjs" (
      "%DSH_APP_ROOT%\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" "%DSH_APP_ROOT%\resources\runtime\pnpm\bin\pnpm.cjs" %*
      exit /b %ERRORLEVEL%
    )
  )
)
node "%~dp0scripts\dsh-runner.mjs" %*
