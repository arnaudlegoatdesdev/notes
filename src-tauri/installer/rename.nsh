; Preserve the existing application directory and WebView storage when upgrading
; the first release. Legacy names below are compatibility identifiers only.
!define NOTES_LEGACY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Flion"
!define NOTES_LEGACY_PRODUCT_KEY "Software\flion\Flion"
Var NotesLegacyDirectory
Var NotesLegacyFound
Var NotesLegacyDesktop
Var NotesSavedUpdateMode

!macro NSIS_HOOK_PREINSTALL
  StrCpy $NotesLegacyFound 0
  ReadRegStr $0 HKCU "${UNINSTKEY}" "MainBinaryName"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${NOTES_LEGACY_KEY}" "DisplayName"
    ReadRegStr $1 HKCU "${NOTES_LEGACY_KEY}" "MainBinaryName"
    ReadRegStr $NotesLegacyDirectory HKCU "${NOTES_LEGACY_PRODUCT_KEY}" ""
    ${If} $0 == "Flion"
    ${AndIf} $1 == "flion.exe"
    ${AndIf} $NotesLegacyDirectory != ""
    ${AndIf} ${FileExists} "$NotesLegacyDirectory\flion.exe"
    ${AndIf} ${FileExists} "$NotesLegacyDirectory\uninstall.exe"
      !insertmacro CheckIfAppIsRunning "$NotesLegacyDirectory\flion.exe" "Notes"
      StrCpy $NotesLegacyFound 1
      StrCpy $INSTDIR $NotesLegacyDirectory
      SetOutPath $INSTDIR
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $NotesLegacyFound = 1
  ${AndIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ; Retire the old binary only after the replacement has been copied.
    Delete "$NotesLegacyDirectory\flion.exe"
    DeleteRegKey HKCU "${NOTES_LEGACY_KEY}"
    DeleteRegKey HKCU "${NOTES_LEGACY_PRODUCT_KEY}"
    StrCpy $NotesLegacyDesktop 0
    !insertmacro IsShortcutTarget "$SMPROGRAMS\Flion.lnk" "$NotesLegacyDirectory\flion.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\Flion.lnk"
      Delete "$SMPROGRAMS\Flion.lnk"
    ${EndIf}
    !insertmacro IsShortcutTarget "$DESKTOP\Flion.lnk" "$NotesLegacyDirectory\flion.exe"
    Pop $0
    ${If} $0 = 1
      StrCpy $NotesLegacyDesktop 1
      !insertmacro UnpinShortcut "$DESKTOP\Flion.lnk"
      Delete "$DESKTOP\Flion.lnk"
    ${EndIf}
    ; The stock updater skips new shortcuts. A rename needs the new label once.
    StrCpy $NotesSavedUpdateMode $UpdateMode
    StrCpy $UpdateMode 0
    Call CreateOrUpdateStartMenuShortcut
    ${If} $NotesLegacyDesktop = 1
      Call CreateOrUpdateDesktopShortcut
    ${EndIf}
    StrCpy $UpdateMode $NotesSavedUpdateMode
  ${EndIf}
!macroend
