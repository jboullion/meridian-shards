@echo off
rem Builds the original (101) server from server\src-101: blakserv, the Kod and its resources,
rem then merges the Kod's string resources into rsc0000.rsb for the client (rscmerge, as
rem contrib\powershell\easy_compile_and_release_bundler.ps1 does).
rem Usage: server\build.cmd [extra nmake targets/args]   (default: the server parts only)
setlocal
set VSDEVCMD=C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat
if not exist "%VSDEVCMD%" (
  echo VsDevCmd.bat not found at "%VSDEVCMD%". Edit server\build.cmd for your Visual Studio install.
  exit /b 1
)
call "%VSDEVCMD%" -arch=x86 -host_arch=x64 >nul || exit /b 1
cd /d "%~dp0src-101" || exit /b 1
rem Newer MSVC raises new warnings and common.mak may use /WX.
rem _CL_ is appended to every cl command line, so this turns /WX off without touching the source.
set _CL_=/WX-
rem The Kod build copies each .rsc into run\server\rsc (kod\bin\instrsc.bat): make sure it's there
for %%d in (rsc loadkod) do if not exist "run\server\%%d\" mkdir "run\server\%%d"
if not exist "run\localclient\resource\" mkdir "run\localclient\resource"
if "%~1"=="" (
  nmake -nologo Bserver Butil Bkod || exit /b 1
) else (
  nmake -nologo %* || exit /b 1
)
if exist bin\rscmerge.exe (
  bin\rscmerge.exe -o run\server\rsc0000.rsb run\server\rsc\*.rsc || exit /b 1
  echo Client strings: server\src-101\run\server\rsc0000.rsb
)
