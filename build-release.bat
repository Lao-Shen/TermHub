@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   TermHub 一键构建打包（Windows x64）
echo   版本号在 build\installer.iss 顶部 MyAppVersion
echo ============================================

REM 运行中的 TermHub 会锁住 bin\TermHub.exe，可能导致构建失败，先提醒
tasklist /fi "imagename eq TermHub.exe" 2>nul | findstr /i "TermHub.exe" >nul
if not errorlevel 1 (
    echo [!] 检测到 TermHub 正在运行，构建可能无法覆盖旧 exe，建议先关闭。
)

REM 检查 wails3
where wails3 >nul 2>nul
if errorlevel 1 (
    echo [X] 未找到 wails3 命令，请先安装 Wails v3 并加入 PATH。
    pause
    exit /b 1
)

REM 从 installer.iss 读取版本号，注入 exe（Taskfile 的 -ldflags main.currentVersion），
REM 让程序自报版本与安装包一致；自动更新靠它比较版本，缺了会一直是 dev 而失效。
set "VER=__NONE__"
for /f "tokens=3 delims= " %%v in ('findstr /c:"#define MyAppVersion" build\installer.iss') do set VER=%%v
set "VER=%VER:"=%"
if "%VER%"=="__NONE__" (
    echo [X] 未能从 build\installer.iss 解析出版本号（MyAppVersion 是否已填），请检查该文件。
    pause
    exit /b 1
)
set "PM_VERSION=%VER%"
echo     版本号：%VER%

REM 1/2 构建
echo.
echo [1/2] wails3 build（PM_VERSION=%PM_VERSION%）...
call wails3 build
if errorlevel 1 (
    echo [X] 构建失败，请检查上方输出。若提示文件被占用，先关闭 TermHub 再试。
    pause
    exit /b 1
)

REM 定位 ISCC：优先 PATH，回退已知安装目录。
REM 注意：批处理中引号内的半角括号会破坏语法，路径写法不能含括号，
REM 若你的 Inno Setup 装在其他位置，请修改下面这一行
set "ISCC="
where ISCC >nul 2>nul && set "ISCC=ISCC"
if not defined ISCC if exist "D:\Install\Inno Setup 6\ISCC.exe" set "ISCC=D:\Install\Inno Setup 6\ISCC.exe"
if not defined ISCC (
    echo [X] 未找到 Inno Setup 的 ISCC.exe：请将其目录加入 PATH，或修改本脚本中的查找路径。
    pause
    exit /b 1
)

REM 2/2 打包
echo.
echo [2/2] Inno Setup 打包（build\installer.iss）...
"%ISCC%" build\installer.iss
if errorlevel 1 (
    echo [X] 打包失败，请检查上方输出。
    pause
    exit /b 1
)

echo.
echo [OK] 完成！安装包：dist\TermHub-Setup-%VER%.exe
echo      发布新版本时修改 build\installer.iss 顶部的 MyAppVersion 后重跑本脚本。
pause
endlocal
