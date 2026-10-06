@echo off
rem Prepares server\src\run\server after a build: creates the folders blakserv
rem expects and installs our config. Safe to run again; it never touches savegames.
setlocal
set RUN=%~dp0src\run\server
for %%d in (loadkod rsc rooms memmap savegame channel) do (
  if exist "%RUN%\%%d" if not exist "%RUN%\%%d\" del "%RUN%\%%d"
  if not exist "%RUN%\%%d\" mkdir "%RUN%\%%d"
)
copy /Y "%~dp0config\blakserv.cfg" "%RUN%\blakserv.cfg" >nul || exit /b 1
echo Run folder ready: %RUN%
