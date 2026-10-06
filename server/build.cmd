@echo off
rem Builds blakserv, the Kod and the server resources from server\src.
rem Usage: server\build.cmd [extra nmake targets/args]   (default: the server parts only)
setlocal
set VSDEVCMD=C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat
if not exist "%VSDEVCMD%" (
  echo VsDevCmd.bat not found at "%VSDEVCMD%". Edit server\build.cmd for your Visual Studio install.
  exit /b 1
)
call "%VSDEVCMD%" -arch=x86 -host_arch=x64 >nul || exit /b 1
cd /d "%~dp0src" || exit /b 1
rem The source targets VS2015; newer MSVC raises new warnings and common.mak has /WX.
rem _CL_ is appended to every cl command line, so this turns /WX off without touching the source.
set _CL_=/WX-
if "%~1"=="" (
  nmake -nologo debug=1 Bzlib Bjansson Bserver Bkod
) else (
  nmake -nologo debug=1 %*
)
