@echo off
rem Prepares server\src\run\server after a build: creates the folders blakserv
rem expects and installs our config and message of the day. Safe to run again; it
rem never touches savegames.
setlocal
set RUN=%~dp0src\run\server
for %%d in (loadkod rsc rooms memmap savegame channel) do (
  if exist "%RUN%\%%d" if not exist "%RUN%\%%d\" del "%RUN%\%%d"
  if not exist "%RUN%\%%d\" mkdir "%RUN%\%%d"
)
copy /Y "%~dp0config\blakserv.cfg" "%RUN%\blakserv.cfg" >nul || exit /b 1
rem The message of the day: blakserv moves motd.txt into memmap\ at startup or on "reload motd"
copy /Y "%~dp0config\motd.txt" "%RUN%\motd.txt" >nul || exit /b 1
echo Run folder ready: %RUN%
