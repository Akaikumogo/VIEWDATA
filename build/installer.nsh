; Included by electron-builder before MUI2, so these defines restyle every installer page.

!define MUI_BGCOLOR "0A0A0B"
!define MUI_TEXTCOLOR "E4E4E7"
!define MUI_INSTFILESPAGE_COLORS "A1A1AA 0A0A0B"
!define MUI_INSTFILESPAGE_PROGRESSBAR "colored"

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Viewdata"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "Every database you run, on one dark screen.$\r$\n$\r$\nViewdata connects to PostgreSQL, MySQL, MariaDB, Oracle and MongoDB, tracks their size over time and draws each schema so related tables arrange themselves.$\r$\n$\r$\nEverything the app needs ships inside this installer. Click Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "Viewdata is ready"
  !define MUI_FINISHPAGE_TITLE_3LINES
  !define MUI_FINISHPAGE_TEXT "A shortcut has been placed on your desktop.$\r$\n$\r$\nOpen the app and add a connection, or start with the bundled sample database."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Launch Viewdata now"
  !define MUI_FINISHPAGE_RUN_FUNCTION "LaunchViewdata"
  !insertmacro MUI_PAGE_FINISH

  Function LaunchViewdata
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  FunctionEnd
!macroend
