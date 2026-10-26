; ============================================================
; TermHub Windows 安装包脚本(Inno Setup 6)
;
; 用法(在项目根目录执行):
;   1. wails3 build                        ; 先构建,产出 bin\TermHub.exe
;   2. ISCC.exe build\installer.iss        ; 打包,产出 dist\TermHub-Setup-<版本>.exe
;   (本机 ISCC 位于 D:\Install\Inno Setup 6\ISCC.exe,未加入 PATH)
;
; 发布前只需修改下面 MyAppVersion 一处版本号,其余无需改动。
; ============================================================

#define MyAppName "TermHub"
; ★ 打包版本号:发布时手动修改(示例 0.1.0)
#define MyAppVersion "1.8.5"
#define MyAppPublisher "TermHub"
#define MyAppExeName "TermHub.exe"

[Setup]
; 应用唯一标识(固定不变,升级安装时按此覆盖旧版)
AppId={{12B62DEE-6115-42E4-969F-57448C1B5739}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
; 仅 Windows x64(Wails3 产物为 amd64);安装包不内置 .NET/WebView2
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; 单用户即可安装(autopf 自动落到用户 Programs 目录,无需管理员)
PrivilegesRequired=lowest
; 安装时若应用正在运行,先请求关闭再覆盖
CloseApplications=yes
; 安装包元信息
OutputDir=..\dist
OutputBaseFilename=TermHub-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=windows\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Default.isl"

[Tasks]
; 桌面快捷方式(默认勾选)
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; 单文件发布:Wails3 已把前端资产嵌入 exe,无需附带运行时
Source: "..\bin\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; 安装完成后询问是否立即运行
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
