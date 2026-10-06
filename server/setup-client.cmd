@echo off
rem Prepares our own build of the original Windows client (server\src\run\localclient)
rem for the parity test. Run after "server\build.cmd Bclient Bmodules".
rem
rem Graphics, sounds and music come from the installed 104 client, but files our
rem build already put there (rsc0000.rsb, the .roo rooms, the module DLLs) are kept:
rem they must match our server, or the redbook token and room checksums break.
setlocal
set SRC=%LOCALAPPDATA%\Meridian-104
set DST=%~dp0src\run\localclient
if not exist "%SRC%\resource" (
  echo Installed client not found at "%SRC%". Edit server\setup-client.cmd.
  exit /b 1
)
for %%f in (D3DX9_43.dll irrKlang.dll ikpMP3.dll Heidelb1.ttf) do (
  if exist "%SRC%\%%f" copy /Y "%SRC%\%%f" "%DST%\" >nul
)
rem /XC /XN /XO: never overwrite a file that already exists in our client folder.
robocopy "%SRC%\resource" "%DST%\resource" /E /XC /XN /XO /NFL /NDL /NJH /NJS /NP
if %ERRORLEVEL% GEQ 8 exit /b 1
echo Client ready: %DST%\meridian.exe /U:^<user^> /W:^<password^> /H:localhost /P:5959
exit /b 0
