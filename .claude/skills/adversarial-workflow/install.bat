@echo off
rem Installer for the adversarial-workflow skill and its bundled entailment-lens agent.
rem Windows counterpart of install.sh: same flags, same behavior. Run with --help.
rem
rem Claude Code resolves agentType 'entailment-lens' from its agent registry
rem (.claude\agents\), never from a skill directory, and it reads agent definitions
rem only at session start. So this script places both halves, and a restart is
rem required after the agent file is first installed or changed.
rem
rem Style note for editors: no %VAR% that may hold a path is ever expanded inside a
rem parenthesized block - a ")" in a path (C:\Program Files (x86)\...) would close
rem the block early. Branch with goto instead. Delayed expansion stays off so "!"
rem in paths survives. Keep CRLF line endings: cmd misparses labels in LF files.
setlocal EnableExtensions DisableDelayedExpansion

set "SKILL_NAME=adversarial-workflow"
set "AGENT_NAME=entailment-lens"
set "SRC=%~dp0"
if "%SRC:~-1%"=="\" set "SRC=%SRC:~0,-1%"
set "AGENT_SRC=%SRC%\agents\%AGENT_NAME%.md"

set "ROOT=%USERPROFILE%\.claude"
set "MODE=install"
set "FORCE=0"
set "RC=0"

rem Double-clicked from Explorer: keep the window open at the end.
set "PAUSE_AT_END=0"
echo(%CMDCMDLINE%| find /i "%~nx0" >nul && set "PAUSE_AT_END=1"

:parse
if "%~1"=="" goto parsed
if /i "%~1"=="--project" goto opt_project
if /i "%~1"=="--check" goto opt_check
if /i "%~1"=="--uninstall" goto opt_uninstall
if /i "%~1"=="--force" goto opt_force
if /i "%~1"=="-h" goto usage
if /i "%~1"=="--help" goto usage
if "%~1"=="/?" goto usage
echo unknown argument: %1 - try --help 1>&2
set "RC=2"
goto done

:opt_check
set "MODE=check"
shift
goto parse

:opt_uninstall
set "MODE=uninstall"
shift
goto parse

:opt_force
set "FORCE=1"
shift
goto parse

:opt_project
if "%~2"=="" goto project_missing
if not exist "%~2\" goto project_notfound
set "PDIR=%~f2"
if "%PDIR:~-1%"=="\" set "PDIR=%PDIR:~0,-1%"
set "ROOT=%PDIR%\.claude"
shift
shift
goto parse

:project_missing
echo --project needs a directory 1>&2
set "RC=2"
goto done

:project_notfound
echo --project directory not found: %2 1>&2
set "RC=2"
goto done

:usage
echo Installer for the adversarial-workflow skill and its bundled entailment-lens agent.
echo.
echo Usage:
echo   install.bat                 install for the current user (%%USERPROFILE%%\.claude)
echo   install.bat --project DIR   install into DIR\.claude (shared with that repo)
echo   install.bat --check         report status only; exit 0 = ready, 1 = action needed
echo   install.bat --force         overwrite an installed copy that differs
echo   install.bat --uninstall     remove the skill and the agent from the chosen scope
echo.
echo Flags combine: install.bat --project . --check
echo Restart Claude Code after installing: agent definitions load at session start only.
goto done

:parsed
set "SKILL_DST=%ROOT%\skills\%SKILL_NAME%"
set "AGENT_DST=%ROOT%\agents\%AGENT_NAME%.md"
if exist "%AGENT_SRC%" goto have_agent_src
echo bundled agent missing: %AGENT_SRC% 1>&2
set "RC=2"
goto done
:have_agent_src

rem The skill counts as installed when this script already runs from inside the
rem target scope, or when the target holds a copy.
set "IN_PLACE=0"
for %%I in ("%SKILL_DST%") do if /i "%%~fI"=="%SRC%" set "IN_PLACE=1"

if "%MODE%"=="check" goto do_check
if "%MODE%"=="uninstall" goto do_uninstall
goto do_install

rem --- check -----------------------------------------------------------------
:do_check
if "%IN_PLACE%"=="1" goto check_skill_ok
if exist "%SKILL_DST%\SKILL.md" goto check_skill_ok
echo skill:  MISSING %SKILL_DST%
set "RC=1"
goto check_agent
:check_skill_ok
echo skill:  ok      %SKILL_DST%

:check_agent
if exist "%AGENT_DST%" goto check_agent_cmp
echo agent:  MISSING %AGENT_DST%
set "RC=1"
goto check_end
:check_agent_cmp
fc /b "%AGENT_SRC%" "%AGENT_DST%" >nul 2>&1
if not errorlevel 1 goto check_agent_ok
echo agent:  DIFFERS %AGENT_DST% - from the bundled copy; reinstall with --force
set "RC=1"
goto check_end
:check_agent_ok
echo agent:  ok      %AGENT_DST%

:check_end
if "%RC%"=="0" echo Ready. If you installed or changed the agent during this session, restart Claude Code first.
goto done

rem --- uninstall -------------------------------------------------------------
:do_uninstall
if "%IN_PLACE%"=="0" goto uninstall_skill
echo not removing %SKILL_DST%: this script runs from it - delete the folder yourself
goto uninstall_agent
:uninstall_skill
if not exist "%SKILL_DST%\" goto uninstall_agent
rmdir /s /q "%SKILL_DST%"
echo removed %SKILL_DST%
:uninstall_agent
if not exist "%AGENT_DST%" goto done
del /f /q "%AGENT_DST%"
echo removed %AGENT_DST%
goto done

rem --- install ---------------------------------------------------------------
:do_install
if not exist "%ROOT%\skills\" mkdir "%ROOT%\skills"
if not exist "%ROOT%\agents\" mkdir "%ROOT%\agents"

if "%IN_PLACE%"=="0" goto install_skill
echo skill:  already in place at %SKILL_DST%
goto install_agent

:install_skill
if not exist "%SKILL_DST%\" goto copy_skill
call :samedir "%SRC%" "%SKILL_DST%"
if "%SAME%"=="0" goto skill_differs
echo skill:  already current at %SKILL_DST%
goto install_agent

:skill_differs
if "%FORCE%"=="1" goto copy_skill
echo skill:  %SKILL_DST% exists and differs from this copy: 1>&2
call :listdiff "%SRC%" "%SKILL_DST%"
echo         rerun with --force to replace it - e.g. to upgrade 1>&2
set "RC=1"
goto done

:copy_skill
if exist "%SKILL_DST%\" rmdir /s /q "%SKILL_DST%"
rem Copy contents, not the folder, so a renamed download still lands as the skill name.
robocopy "%SRC%" "%SKILL_DST%" /E /XF .DS_Store /XD __MACOSX /NFL /NDL /NJH /NJS /NP >nul
rem robocopy: 0-7 = success, 8+ = failure.
if not errorlevel 8 goto skill_copied
echo skill:  copy failed - robocopy reported an error 1>&2
set "RC=1"
goto done
:skill_copied
echo skill:  installed to %SKILL_DST%

:install_agent
set "CHANGED=0"
if not exist "%AGENT_DST%" goto copy_agent
fc /b "%AGENT_SRC%" "%AGENT_DST%" >nul 2>&1
if errorlevel 1 goto agent_differs
echo agent:  already current at %AGENT_DST%
goto install_end

:agent_differs
if "%FORCE%"=="1" goto copy_agent
echo agent:  %AGENT_DST% exists and differs from the bundled copy: 1>&2
fc "%AGENT_DST%" "%AGENT_SRC%" 1>&2
echo         rerun with --force to replace it 1>&2
set "RC=1"
goto done

:copy_agent
copy /y "%AGENT_SRC%" "%AGENT_DST%" >nul
if not errorlevel 1 goto agent_copied
echo agent:  copy failed 1>&2
set "RC=1"
goto done
:agent_copied
set "CHANGED=1"
echo agent:  installed to %AGENT_DST%

:install_end
if "%CHANGED%"=="0" goto done
echo.
echo RESTART Claude Code before the first workflow run: agent definitions load only
echo at session start, so '%AGENT_NAME%' does not resolve in sessions already open.
goto done

rem --- helpers ---------------------------------------------------------------
rem :samedir A B -> SAME=1 when both trees hold the same files with the same bytes
rem (.DS_Store and __MACOSX ignored, matching the excludes in install.sh).
:samedir
set "SAME=1"
for /r "%~1" %%F in (*) do call :cmp_one "%~1" "%~2" "%%F"
for /r "%~2" %%F in (*) do call :exists_in "%~2" "%~1" "%%F"
exit /b 0

:cmp_one
call :relpath "%~1" "%~3"
if "%SKIP%"=="1" exit /b 0
if exist "%~2\%REL%" goto cmp_one_fc
set "SAME=0"
exit /b 0
:cmp_one_fc
fc /b "%~3" "%~2\%REL%" >nul 2>&1
if errorlevel 1 set "SAME=0"
exit /b 0

:exists_in
call :relpath "%~1" "%~3"
if "%SKIP%"=="1" exit /b 0
if not exist "%~2\%REL%" set "SAME=0"
exit /b 0

rem :listdiff A B -> print each file that differs or exists on one side only
:listdiff
for /r "%~1" %%F in (*) do call :list_one "%~1" "%~2" "%%F"
for /r "%~2" %%F in (*) do call :list_extra "%~2" "%~1" "%%F"
exit /b 0

:list_one
call :relpath "%~1" "%~3"
if "%SKIP%"=="1" exit /b 0
if exist "%~2\%REL%" goto list_one_fc
echo   only in this copy: %REL% 1>&2
exit /b 0
:list_one_fc
fc /b "%~3" "%~2\%REL%" >nul 2>&1
if errorlevel 1 echo   differs: %REL% 1>&2
exit /b 0

:list_extra
call :relpath "%~1" "%~3"
if "%SKIP%"=="1" exit /b 0
if not exist "%~2\%REL%" echo   only in installed copy: %REL% 1>&2
exit /b 0

rem :relpath BASE FILE -> REL = FILE relative to BASE; SKIP=1 for macOS junk
:relpath
set "SKIP=0"
set "FULL=%~2"
call set "REL=%%FULL:%~1\=%%"
if /i "%~nx2"==".DS_Store" set "SKIP=1"
echo(%REL%| find /i "__MACOSX" >nul && set "SKIP=1"
exit /b 0

:done
if "%PAUSE_AT_END%"=="1" pause
endlocal & exit /b %RC%
