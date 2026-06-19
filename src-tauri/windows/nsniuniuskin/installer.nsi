Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2

!if "{{compression}}" == "none"
  SetCompress off
!else
  SetCompressor /SOLID "{{compression}}"
!endif

!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh
!include LogicLib.nsh
!include Win\COM.nsh
!include Win\Propkey.nsh
!include StrFunc.nsh
!include "utils.nsh"
!include "FileAssociation.nsh"
${StrCase}
${StrLoc}

!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define HOMEPAGE "{{homepage}}"
!define INSTALLMODE "{{install_mode}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define ADDITIONALPLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define DISPLAYLANGUAGESELECTOR "{{display_language_selector}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH ""
!define WEBVIEW2INSTALLERPATH ""
!define MINIMUMWEBVIEW2VERSION "{{minimum_webview2_version}}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUKEY "Software\${MANUFACTURER}"
!define MANUPRODUCTKEY "${MANUKEY}\${PRODUCTNAME}"
!define UNINSTALLERSIGNCOMMAND "{{uninstaller_sign_command}}"
!define ESTIMATEDSIZE "{{estimated_size}}"
!define STARTMENUFOLDER "{{start_menu_folder}}"

{{#if file_associations}}
  !define FILEASSOCIATIONS
{{/if}}

{{#if deep_link_protocols}}
  !define DEEPLINKPROTOCOLS
{{/if}}

; === Tab Index Defines ===
!define INSTALL_PAGE_CONFIG         0
!define INSTALL_PAGE_PROCESSING     1
!define INSTALL_PAGE_FINISH         2
!define INSTALL_PAGE_UNISTCONFIG    3
!define INSTALL_PAGE_UNISTPROCESSING 4
!define INSTALL_PAGE_UNISTFINISH    5

; === Variables ===
Var hInstallDlg
Var hInstallSubDlg
Var InstallState
Var DiscordEnabled
Var CrtEnabled
Var RuneTitlebar
Var TransitionsEnabled
Var PassiveMode
Var UpdateMode
Var RestartMode
Var NoShortcutMode
Var DeleteAppData
Var ReinstallPageCheck
Var unSilentMode

Name "${PRODUCTNAME}"
BrandingText "${COPYRIGHT}"
OutFile "${OUTFILE}"

!define PLACEHOLDER_INSTALL_DIR "placeholder\${PRODUCTNAME}"
InstallDir "${PLACEHOLDER_INSTALL_DIR}"

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${PRODUCTNAME} Installer"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

!addplugindir "${ADDITIONALPLUGINSPATH}"

!if "${UNINSTALLERSIGNCOMMAND}" != ""
  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}'
!endif

!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel admin
!endif

!if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
!endif

!if "${INSTALLMODE}" == "both"
  !define MULTIUSER_MUI
  !define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCTNAME}"
  !define MULTIUSER_INSTALLMODE_COMMANDLINE
  !if "${ARCH}" == "x64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !else if "${ARCH}" == "arm64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !endif
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${UNINSTKEY}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "CurrentUser"
  !define MULTIUSER_INSTALLMODEPAGE_SHOWUSERNAME
  !define MULTIUSER_INSTALLMODE_FUNCTION RestorePreviousInstallLocation
  !define MULTIUSER_EXECUTIONLEVEL Highest
  !include MultiUser.nsh
!endif

; ─── .onInit ──────────────────────────────────────────────

Function .onInit
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"

  File "..\..\..\..\windows\nsniuniuskin\skin.zip"

  ; Parse CLI flags
  StrCpy $NoShortcutMode 0
  StrCpy $RestartMode 0
  ${GetParameters} $0
  ${GetOptions} $0 "/P" $1
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}
  ${GetOptions} $0 "/S" $1
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}
  ${GetOptions} $0 "/UPDATE" $1
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}
  ${GetOptions} $0 "/R" $1
  ${IfNot} ${Errors}
    StrCpy $RestartMode 1
  ${EndIf}
  ${GetOptions} $0 "/NS" $1
  ${IfNot} ${Errors}
    StrCpy $NoShortcutMode 1
  ${EndIf}

  ; Detect previous install
  ReadRegStr $0 SHCTX "${UNINSTKEY}" "UninstallString"
  ${If} "$0" != ""
    StrCpy $UpdateMode 1
  ${EndIf}

  ; Set default install dir
  Call SetDefaultInstallDir

  ; Show DUI or auto-install
  Call DUIPage
FunctionEnd

; ─── DUIPage — Main Installer UI ──────────────────────────

Function DUIPage
  ; In passive/silent mode, auto-install without UI
  ${If} $PassiveMode == 1
    StrCpy $DiscordEnabled "1"
    StrCpy $CrtEnabled "0"
    StrCpy $RuneTitlebar "1"
    StrCpy $TransitionsEnabled "1"
    SetAutoClose true
    Call SilentInstall
    Return
  ${EndIf}

  nsNiuniuSkin::InitSkinPage "$PLUGINSDIR\" ""
  Pop $hInstallDlg

  nsNiuniuSkin::SetWindowTile $hInstallDlg "${PRODUCTNAME} Installer"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "versionLabel" "text" "v${VERSION}"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "editDir" "text" "$INSTDIR\"
  Call UpdateDiskSpace

  nsNiuniuSkin::ShowPageItem $hInstallDlg "wizardTab" ${INSTALL_PAGE_CONFIG}

  Call BindUIControls
  nsNiuniuSkin::ShowPage 0
FunctionEnd

; ─── BindUIControls ───────────────────────────────────────

Function BindUIControls
  Push $0

  GetFunctionAddress $0 OnBtnInstall
  nsNiuniuSkin::BindCallBack $hInstallDlg "btnInstall" $0

  GetFunctionAddress $0 OnBtnSelectDir
  nsNiuniuSkin::BindCallBack $hInstallDlg "btnSelectDir" $0

  GetFunctionAddress $0 OnBtnShowMore
  nsNiuniuSkin::BindCallBack $hInstallDlg "btnShowMore" $0

  GetFunctionAddress $0 OnBtnHideMore
  nsNiuniuSkin::BindCallBack $hInstallDlg "btnHideMore" $0

  GetFunctionAddress $0 OnBtnAgreement
  nsNiuniuSkin::BindCallBack $hInstallDlg "btnAgreement" $0

  GetFunctionAddress $0 OnBtnLicClose
  nsNiuniuSkin::BindCallBack $hInstallDlg "btnLicClose" $0

  GetFunctionAddress $0 OnBtnFinish
  nsNiuniuSkin::BindCallBack $hInstallDlg "btnRun" $0

  GetFunctionAddress $0 OnExitDUISetup
  nsNiuniuSkin::BindCallBack $hInstallDlg "btnClose" $0

  GetFunctionAddress $0 OnBtnMin
  nsNiuniuSkin::BindCallBack $hInstallDlg "btnFinishedMin" $0

  GetFunctionAddress $0 OnEditDirChange
  nsNiuniuSkin::BindCallBack $hInstallDlg "editDir" $0

  GetFunctionAddress $0 OnSysCommandCloseEvent
  nsNiuniuSkin::BindCallBack $hInstallDlg "syscommandclose" $0

  Pop $0
FunctionEnd

; ─── OnBtnInstall ─────────────────────────────────────────

Function OnBtnInstall
  nsNiuniuSkin::GetControlAttribute $hInstallDlg "chkAgree" "selected"
  Pop $0
  ${If} $0 == "0"
    Push $hInstallDlg
    Push "License Required"
    Push "Please accept the license agreement before installing."
    Call ShowMsgBox
    Return
  ${EndIf}

  ; Check if app is running
  nsProcess::_FindProcess "${MAINBINARYNAME}.exe"
  Pop $R0
  ${If} $R0 == 0
    Push $hInstallDlg
    Push "App Running"
    Push "${PRODUCTNAME} is currently running. Please close it before installing."
    Call ShowMsgBox
    Return
  ${EndIf}

  ; Validate install path
  nsNiuniuSkin::GetControlAttribute $hInstallDlg "editDir" "text"
  Pop $0
  ${If} "$0" == ""
    Return
  ${EndIf}
  StrCpy $INSTDIR $0
  Call ValidatePath
  ${If} $0 == 0
    Return
  ${EndIf}

  ; Read feature toggles
  nsNiuniuSkin::GetControlAttribute $hInstallDlg "chkDiscord" "selected"
  Pop $DiscordEnabled
  nsNiuniuSkin::GetControlAttribute $hInstallDlg "chkCrt" "selected"
  Pop $CrtEnabled
  nsNiuniuSkin::GetControlAttribute $hInstallDlg "chkRune" "selected"
  Pop $RuneTitlebar
  nsNiuniuSkin::GetControlAttribute $hInstallDlg "chkTransitions" "selected"
  Pop $TransitionsEnabled

  ; Switch to progress page
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "btnClose" "enabled" "false"
  nsNiuniuSkin::ShowPageItem $hInstallDlg "wizardTab" ${INSTALL_PAGE_PROCESSING}
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrProgress" "min" "0"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrProgress" "max" "100"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_pos" "text" "0%"

  GetFunctionAddress $0 BackgroundInstall
  BgWorker::CallAndWait
FunctionEnd

; ─── SilentInstall (no UI) ─────────────────────────────────

Function SilentInstall
  SetOutPath "$INSTDIR"
  File "${MAINBINARYSRCPATH}"
  SetOutPath "$INSTDIR\resources"
  {{#each resources_dirs}}
  CreateDirectory "$OUTDIR\\{{this}}"
  {{/each}}
  SetOutPath "$INSTDIR\resources"
  {{#each resources}}
  File "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}
  SetOutPath "$INSTDIR"
  {{#each binaries}}
  File "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}
  WriteUninstaller "$INSTDIR\uninstall.exe"
  ; Skip WebView2 install in silent/passive mode for speed
  Call WriteSettings
  Call CreateShortcuts
  Call WriteRegistry
  !ifdef FILEASSOCIATIONS
    Call RegisterFileAssociations
  !endif
  !ifdef DEEPLINKPROTOCOLS
    Call RegisterDeepLinks
  !endif
  ; Relaunch the app after an updater-triggered install. The Tauri updater
  ; only passes /R (restart) when it launched the installer itself, then exits
  ; the old app immediately — so it's our job to bring the app back up. `Exec`
  ; launches it detached (same idiom as the finish page) so it survives the
  ; installer exiting.
  ${If} $RestartMode == 1
    Exec '"$INSTDIR\${MAINBINARYNAME}.exe"'
  ${EndIf}
FunctionEnd

; ─── BackgroundInstall (with UI) ───────────────────────────

Function BackgroundInstall
  Call InstallFiles
  Call InstallWebView2
  Call WriteSettings
  Call CreateShortcuts
  Call WriteRegistry
  !ifdef FILEASSOCIATIONS
    Call RegisterFileAssociations
  !endif
  !ifdef DEEPLINKPROTOCOLS
    Call RegisterDeepLinks
  !endif

  nsNiuniuSkin::SetControlAttribute $hInstallDlg "btnClose" "enabled" "true"
  StrCpy $InstallState 1
  nsNiuniuSkin::ShowPageItem $hInstallDlg "wizardTab" ${INSTALL_PAGE_FINISH}
FunctionEnd

; ─── InstallFiles ─────────────────────────────────────────

Function InstallFiles
  SetOutPath "$INSTDIR"

  nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_tip" "text" "Copying application files..."
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_pos" "text" "10%"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrProgress" "value" "10"
  File "${MAINBINARYSRCPATH}"

  nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_pos" "text" "20%"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrProgress" "value" "20"

  SetOutPath "$INSTDIR\resources"
  {{#each resources_dirs}}
  CreateDirectory "$OUTDIR\\{{this}}"
  {{/each}}

  nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_pos" "text" "40%"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrProgress" "value" "40"

  SetOutPath "$INSTDIR\resources"
  {{#each resources}}
  File "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}

  SetOutPath "$INSTDIR"
  {{#each binaries}}
  File "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}

  nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_pos" "text" "60%"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrProgress" "value" "60"

  !ifmacrodef NSIS_HOOK_PREINSTALL
    !insertmacro NSIS_HOOK_PREINSTALL
  !endif

  WriteUninstaller "$INSTDIR\uninstall.exe"
FunctionEnd

; ─── InstallWebView2 ───────────────────────────────────────

Function InstallWebView2
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_tip" "text" "Checking WebView2..."
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "install_detail" "text" "Checking if WebView2 is installed..."

  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
    ReadRegDWORD $0 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}

  ${If} $0 == ""
    nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_tip" "text" "Downloading WebView2..."
    nsNiuniuSkin::SetControlAttribute $hInstallDlg "install_detail" "text" "Downloading WebView2 bootstrapper..."

    !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
      NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe"
      Pop $0
      ${If} $0 == "success"
        ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install'
      ${EndIf}
    !endif
  ${EndIf}

  nsNiuniuSkin::SetControlAttribute $hInstallDlg "install_detail"  "text" ""
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_pos" "text" "70%"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrProgress" "value" "70"
FunctionEnd

; ─── WriteSettings ─────────────────────────────────────────

Function WriteSettings
  StrCpy $R0 "$APPDATA\galdr"
  CreateDirectory "$R0"

  ; Preserve existing user settings — only write defaults on first install
  ${IfNot} ${FileExists} "$R0\settings.json"
    ${If} $DiscordEnabled == "1"
      StrCpy $R6 "true"
    ${Else}
      StrCpy $R6 "false"
    ${EndIf}

    ${If} $CrtEnabled == "1"
      StrCpy $R7 "true"
    ${Else}
      StrCpy $R7 "false"
    ${EndIf}

    ${If} $RuneTitlebar == "1"
      StrCpy $R8 "true"
    ${Else}
      StrCpy $R8 "false"
    ${EndIf}

    ${If} $TransitionsEnabled == "1"
      StrCpy $R9 "rune-dissolve"
    ${Else}
      StrCpy $R9 "none"
    ${EndIf}

    FileOpen $R1 "$R0\settings.json" w
    FileWrite $R1 '{"outputDir":"","transitionStyle":"$R9","crtEnabled":$R7,"showRuneInTitlebar":$R8,"discordEnabled":$R6}'
    FileClose $R1
  ${EndIf}

  ${If} $hInstallDlg != ""
    nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_pos" "text" "80%"
    nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrProgress" "value" "80"
  ${EndIf}
FunctionEnd

; ─── CreateShortcuts ───────────────────────────────────────

Function CreateShortcuts
  ${If} $NoShortcutMode == 1
    Return
  ${EndIf}

  ${If} $hInstallDlg != ""
    nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_tip" "text" "Creating shortcuts..."
  ${EndIf}

  ; Start Menu shortcut
  CreateDirectory "$SMPROGRAMS\${PRODUCTNAME}"
  ClearErrors
  CreateShortCut "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk" \
                 "$INSTDIR\${MAINBINARYNAME}.exe" "" \
                 "$INSTDIR\${MAINBINARYNAME}.exe" 0 \
                 SW_SHOWNORMAL "" "Launch ${PRODUCTNAME}"
  ${If} ${Errors}
    ClearErrors
  ${EndIf}

  ; Desktop shortcut
  ClearErrors
  CreateShortCut "$DESKTOP\${PRODUCTNAME}.lnk" \
                 "$INSTDIR\${MAINBINARYNAME}.exe" "" \
                 "$INSTDIR\${MAINBINARYNAME}.exe" 0 \
                 SW_SHOWNORMAL "" "Launch ${PRODUCTNAME}"
  ${If} ${Errors}
    ClearErrors
  ${EndIf}

  ; Notify Explorer so shortcuts appear immediately
  System::Call 'shell32.dll::SHChangeNotify(i 0x8000000, i 0, p 0, p 0)'

  ${If} $hInstallDlg != ""
    nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_pos" "text" "90%"
    nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrProgress" "value" "90"
  ${EndIf}
FunctionEnd

; ─── WriteRegistry ─────────────────────────────────────────

Function WriteRegistry
  ${If} $hInstallDlg != ""
    nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_tip" "text" "Configuring system..."
  ${EndIf}

  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr SHCTX "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" 1
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallDate" ""
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "${ESTIMATEDSIZE}"

  ${If} "${HOMEPAGE}" != ""
    WriteRegStr SHCTX "${UNINSTKEY}" "URLInfoAbout" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "${HOMEPAGE}"
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTINSTALL
    !insertmacro NSIS_HOOK_POSTINSTALL
  !endif

  ${If} $hInstallDlg != ""
    nsNiuniuSkin::SetControlAttribute $hInstallDlg "progress_pos" "text" "95%"
    nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrProgress" "value" "95"
  ${EndIf}
FunctionEnd

; ─── RegisterFileAssociations ─────────────────────────────

{{#if file_associations}}
Function RegisterFileAssociations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
  !insertmacro APP_ASSOCIATE "{{ext}}" "{{or association.name ext}}" "{{association-description association.description ext}}" "$INSTDIR\${MAINBINARYNAME}.exe,0" "Open with ${PRODUCTNAME}" "$INSTDIR\${MAINBINARYNAME}.exe $\"%1$\""
    {{/each}}
  {{/each}}
FunctionEnd
{{/if}}

; ─── RegisterDeepLinks ────────────────────────────────────

{{#if deep_link_protocols}}
Function RegisterDeepLinks
  {{#each deep_link_protocols}}
  WriteRegStr SHCTX "Software\Classes\\{{this}}" "" "URL:${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\\{{this}}" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\\{{this}}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  {{/each}}
FunctionEnd
{{/if}}

; ─── UI Callbacks ──────────────────────────────────────────

Function OnBtnSelectDir
  nsNiuniuSkin::SelectInstallDir
  Pop $0
  ${If} "$0" != ""
    nsNiuniuSkin::SetControlAttribute $hInstallDlg "editDir" "text" "$0\"
    Call UpdateDiskSpace
  ${EndIf}
FunctionEnd

Function OnEditDirChange
  nsNiuniuSkin::GetControlAttribute $hInstallDlg "editDir" "text"
  Pop $0
  StrCpy $INSTDIR $0
  Call UpdateDiskSpace
FunctionEnd

Function OnBtnShowMore
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "moreconfiginfo" "visible" "true"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "btnShowMore" "visible" "false"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "btnHideMore" "visible" "true"
FunctionEnd

Function OnBtnHideMore
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "moreconfiginfo" "visible" "false"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "btnShowMore" "visible" "true"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "btnHideMore" "visible" "false"
FunctionEnd

Function OnBtnAgreement
  ; Open the GPLv3 license in the user's default browser instead of an
  ; in-installer text panel.
  ExecShell "open" "https://www.gnu.org/licenses/gpl-3.0.html"
FunctionEnd

Function OnBtnLicClose
  ; No-op: the in-installer license panel was removed; the license is now
  ; viewed via OnBtnAgreement in a browser. Kept for callback binding safety.
FunctionEnd

Function OnBtnFinish
  nsNiuniuSkin::GetControlAttribute $hInstallDlg "chkRunApp" "selected"
  Pop $0
  ${If} $0 == "1"
    Exec '"$INSTDIR\${MAINBINARYNAME}.exe"'
  ${EndIf}
  nsNiuniuSkin::ExitDUISetup
FunctionEnd

Function OnExitDUISetup
  nsNiuniuSkin::ExitDUISetup
FunctionEnd

Function OnBtnMin
  HideWindow
  ShowWindow $HWNDPARENT ${SW_MINIMIZE}
FunctionEnd

Function OnSysCommandCloseEvent
  ${If} $InstallState == 1
    nsNiuniuSkin::SetControlAttribute $hInstallDlg "btnClose" "enabled" "false"
  ${Else}
    nsNiuniuSkin::ExitDUISetup
  ${EndIf}
FunctionEnd

; ─── ShowMsgBox ────────────────────────────────────────────

Function ShowMsgBox
  Pop $R8
  Pop $R7
  Pop $hInstallSubDlg

  nsNiuniuSkin::InitSkinSubPage "msgBox.xml" "btnOK" "btnCancel,btnClose"
  Pop $hInstallSubDlg

  nsNiuniuSkin::SetControlAttribute $hInstallSubDlg "lblTitle" "text" "$R7"
  nsNiuniuSkin::SetControlAttribute $hInstallSubDlg "lblMsg" "text" "$R8"
  nsNiuniuSkin::ShowSkinSubPage 0
FunctionEnd

; ─── UpdateDiskSpace ───────────────────────────────────────

Function UpdateDiskSpace
  ${GetRoot} "$INSTDIR" $0
  ${DriveSpace} "$0\" "/D=F /S=K" $1
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "local_space" "text" "Available: $1 KB"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "space_required" "text" "Required: ${ESTIMATEDSIZE} KB"
FunctionEnd

; ─── ValidatePath ─────────────────────────────────────────

Function ValidatePath
  ${GetRoot} "$INSTDIR" $0
  ${DriveSpace} "$0\" "/D=F /S=K" $1
  ${If} $1 < ${ESTIMATEDSIZE}
    Push $hInstallDlg
    Push "Insufficient Space"
    Push "Not enough disk space. Required: ${ESTIMATEDSIZE} KB, Available: $1 KB"
    Call ShowMsgBox
    Push 0
    Return
  ${EndIf}
  Push 1
FunctionEnd

; ─── SetDefaultInstallDir ─────────────────────────────────

Function SetDefaultInstallDir
  ${If} "${INSTALLMODE}" == "perMachine"
    StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
  ${Else}
    StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"
  ${EndIf}

  ReadRegStr $0 SHCTX "${UNINSTKEY}" "InstallLocation"
  ${If} "$0" != ""
    StrCpy $INSTDIR $0
  ${EndIf}
FunctionEnd

; ─── RestorePreviousInstallLocation ───────────────────────

Function RestorePreviousInstallLocation
  ReadRegStr $0 SHCTX "${UNINSTKEY}" "InstallLocation"
  ${If} "$0" != ""
    StrCpy $INSTDIR $0
  ${EndIf}
FunctionEnd

; ─── un.onInit — Uninstaller entry point ──────────────────
; NSIS calls this automatically when the uninstaller starts. Without it the
; custom skin UI (un.DUIPage) is never invoked and the empty Uninstall section
; runs instead — so nothing is removed. We also dispatch silent mode (/S) used
; by the updater's QuietUninstallString so headless uninstalls actually work.

Function un.onInit
  StrCpy $unSilentMode 0
  StrCpy $DeleteAppData 0

  ; Restore install dir from registry so $INSTDIR is correct regardless of
  ; where uninstall.exe was launched from.
  ReadRegStr $0 SHCTX "${UNINSTKEY}" "InstallLocation"
  ${If} "$0" != ""
    StrCpy $INSTDIR $0
  ${EndIf}

  ${GetParameters} $0
  ${GetOptions} $0 "/S" $1
  ${IfNot} ${Errors}
    StrCpy $unSilentMode 1
  ${EndIf}

  ${If} $unSilentMode == 1
    ; No UI: run the removal directly and exit.
    Call un.BackgroundUninstall
    SetAutoClose true
    Quit
  ${EndIf}
FunctionEnd

; ─── un.onGUIInit — Show uninstall UI in GUI mode ─────────
; Only fires in interactive (non-silent) runs. This is what makes the skin
; uninstall window appear when the user double-clicks uninstall.exe.

Function un.onGUIInit
  Call un.DUIPage
FunctionEnd

; ─── un.DUIPage — Uninstaller UI ──────────────────────────

Function un.DUIPage
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "..\..\..\..\windows\nsniuniuskin\skin.zip"

  nsNiuniuSkin::InitSkinPage "$PLUGINSDIR\" ""
  Pop $hInstallDlg

  nsNiuniuSkin::SetWindowTile $hInstallDlg "${PRODUCTNAME} Uninstaller"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "whetheruninstall" "text" "Uninstall ${PRODUCTNAME}?"
  nsNiuniuSkin::ShowPageItem $hInstallDlg "wizardTab" ${INSTALL_PAGE_UNISTCONFIG}

  Call un.BindUnInstUIControls
  nsNiuniuSkin::ShowPage 0
FunctionEnd

; ─── un.BindUnInstUIControls ──────────────────────────────

Function un.BindUnInstUIControls
  Push $0

  GetFunctionAddress $0 un.OnBtnUninstall
  nsNiuniuSkin::BindCallBack $hInstallDlg "btnUnInstall" $0

  GetFunctionAddress $0 un.OnBtnCancel
  nsNiuniuSkin::BindCallBack $hInstallDlg "btnCancelUninstall" $0

  GetFunctionAddress $0 un.OnBtnUninstalled
  nsNiuniuSkin::BindCallBack $hInstallDlg "btnUninstalled" $0

  GetFunctionAddress $0 un.OnExitDUISetup
  nsNiuniuSkin::BindCallBack $hInstallDlg "btnClose" $0

  GetFunctionAddress $0 un.OnSysCommandCloseEvent
  nsNiuniuSkin::BindCallBack $hInstallDlg "syscommandclose" $0

  Pop $0
FunctionEnd

; ─── un.OnBtnUninstall ────────────────────────────────────

Function un.OnBtnUninstall
  nsProcess::_FindProcess "${MAINBINARYNAME}.exe"
  Pop $R0
  ${If} $R0 == 0
    Push $hInstallDlg
    Push "App Running"
    Push "${PRODUCTNAME} is running. Please close it before uninstalling."
    Call un.ShowMsgBox
    Return
  ${EndIf}

  nsNiuniuSkin::GetControlAttribute $hInstallDlg "chkDeleteData" "selected"
  Pop $DeleteAppData

  nsNiuniuSkin::SetControlAttribute $hInstallDlg "btnClose" "enabled" "false"
  nsNiuniuSkin::ShowPageItem $hInstallDlg "wizardTab" ${INSTALL_PAGE_UNISTPROCESSING}
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrUnInstProgress" "min" "0"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrUnInstProgress" "max" "100"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "un_progress_pos" "text" "0%"

  GetFunctionAddress $0 un.BackgroundUninstall
  BgWorker::CallAndWait
FunctionEnd

Function un.OnBtnCancel
  nsNiuniuSkin::ExitDUISetup
FunctionEnd

Function un.BackgroundUninstall
  !ifmacrodef NSIS_HOOK_PREUNINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
  !endif

  nsNiuniuSkin::SetControlAttribute $hInstallDlg "un_progress_tip" "text" "Removing files..."
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "un_progress_pos" "text" "20%"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrUnInstProgress" "value" "20"

  RMDir /r "$INSTDIR"

  nsNiuniuSkin::SetControlAttribute $hInstallDlg "un_progress_pos" "text" "40%"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrUnInstProgress" "value" "40"

  ; Remove shortcuts
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCTNAME}\${PRODUCTNAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCTNAME}"

  nsNiuniuSkin::SetControlAttribute $hInstallDlg "un_progress_pos" "text" "60%"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrUnInstProgress" "value" "60"

  ; Remove registry
  DeleteRegKey SHCTX "${UNINSTKEY}"
  DeleteRegKey /ifempty SHCTX "${MANUPRODUCTKEY}"
  DeleteRegKey /ifempty SHCTX "${MANUKEY}"

  ; Remove file associations
  !ifdef FILEASSOCIATIONS
    {{#each file_associations as |association| ~}}
      {{#each association.ext as |ext| ~}}
    !insertmacro APP_UNASSOCIATE "{{ext}}" "{{or association.name ext}}"
      {{/each}}
    {{/each}}
  !endif

  ; Remove deep links
  {{#if deep_link_protocols}}
  {{#each deep_link_protocols}}
  DeleteRegKey SHCTX "Software\Classes\\{{this}}"
  {{/each}}
  {{/if}}

  nsNiuniuSkin::SetControlAttribute $hInstallDlg "un_progress_pos" "text" "80%"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrUnInstProgress" "value" "80"

  ${If} $DeleteAppData == "1"
    SetShellVarContext current
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
    RmDir /r "$APPDATA\galdr"
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif

  nsNiuniuSkin::SetControlAttribute $hInstallDlg "un_progress_pos" "text" "100%"
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "slrUnInstProgress" "value" "100"

  StrCpy $InstallState 1
  nsNiuniuSkin::SetControlAttribute $hInstallDlg "btnClose" "enabled" "true"
  nsNiuniuSkin::ShowPageItem $hInstallDlg "wizardTab" ${INSTALL_PAGE_UNISTFINISH}
FunctionEnd

Function un.OnBtnUninstalled
  nsNiuniuSkin::ExitDUISetup
FunctionEnd

Function un.OnExitDUISetup
  nsNiuniuSkin::ExitDUISetup
FunctionEnd

Function un.OnSysCommandCloseEvent
  ${If} $InstallState == 1
    nsNiuniuSkin::SetControlAttribute $hInstallDlg "btnClose" "enabled" "false"
  ${Else}
    nsNiuniuSkin::ExitDUISetup
  ${EndIf}
FunctionEnd

Function un.ShowMsgBox
  Pop $R8
  Pop $R7
  Pop $hInstallSubDlg

  nsNiuniuSkin::InitSkinSubPage "msgBox.xml" "btnOK" "btnCancel,btnClose"
  Pop $hInstallSubDlg

  nsNiuniuSkin::SetControlAttribute $hInstallSubDlg "lblTitle" "text" "$R7"
  nsNiuniuSkin::SetControlAttribute $hInstallSubDlg "lblMsg" "text" "$R8"
  nsNiuniuSkin::ShowSkinSubPage 0
FunctionEnd

; ─── Sections ──────────────────────────────────────────────

Section "Main"
SectionEnd

; ─── Uninstall Section
Section "Uninstall"
SectionEnd
