@echo off
rem Points server\src at the shards-server repository (a directory junction, no admin rights
rem needed), so every build, run, asset and deploy script here uses that repository directly:
rem a change there is picked up here without copying anything.
rem Usage: server\link-src.cmd [path to shards-server]   (default J:\m59-shards-server\shards-server)
setlocal
set TARGET=%~1
if "%TARGET%"=="" set TARGET=J:\m59-shards-server\shards-server
if not exist "%TARGET%\blakserv\makefile.linux" (
  echo "%TARGET%" doesn't look like the shards-server repository.
  exit /b 1
)
set LINK=%~dp0src
rem An existing junction is replaced; a real folder (an old copy of the source) is left alone.
fsutil reparsepoint query "%LINK%" >nul 2>&1 && rmdir "%LINK%"
if exist "%LINK%\" (
  echo %LINK% is a real folder. Move it aside first, e.g.: move "%LINK%" "%~dp0src-104"
  exit /b 1
)
mklink /J "%LINK%" "%TARGET%" || exit /b 1
echo server\src now points at %TARGET%. Next: server\setup-run.cmd, then server\build.cmd.
