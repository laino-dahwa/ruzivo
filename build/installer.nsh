; Chains the Microsoft Visual C++ 2015-2022 x64 redistributable.
;
; The bundled PostgreSQL binaries (@embedded-postgres/windows-x64) are built
; with MSVC and import VCRUNTIME140.dll, which ships with the redistributable
; rather than with Windows. Without it, initdb.exe cannot start and first-run
; database provisioning fails on an otherwise clean machine.
;
; The redistributable is only run when it is actually missing, and a failure to
; install it warns rather than aborting the app installation — the user may
; have declined the elevation prompt and can install it separately.

!include LogicLib.nsh

!macro customInstall
  Var /GLOBAL vcRuntimeInstalled
  Var /GLOBAL vcRedistExitCode

  ; The redistributable records itself here. Read from the 64-bit view because
  ; the installer process itself is 32-bit.
  SetRegView 64
  ReadRegDWORD $vcRuntimeInstalled HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  SetRegView 32

  ${If} $vcRuntimeInstalled == 1
    DetailPrint "Microsoft Visual C++ runtime already present - skipping."
  ${Else}
    DetailPrint "Installing the Microsoft Visual C++ runtime (required by the bundled PostgreSQL)..."
    InitPluginsDir
    File "/oname=$PLUGINSDIR\vc_redist.x64.exe" "${BUILD_RESOURCES_DIR}\vc_redist.x64.exe"
    ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $vcRedistExitCode
    DetailPrint "Visual C++ runtime installer finished with exit code $vcRedistExitCode."

    ; 0 = installed, 1638 = a newer version is already present,
    ; 3010 = installed but a restart is pending. Anything else really failed.
    ${If} $vcRedistExitCode != 0
    ${AndIf} $vcRedistExitCode != 1638
    ${AndIf} $vcRedistExitCode != 3010
      MessageBox MB_ICONEXCLAMATION|MB_OK "Ruzivo could not install the Microsoft Visual C++ runtime (error $vcRedistExitCode).$\r$\n$\r$\nRuzivo will finish installing, but its built-in database cannot start until that runtime is present. Install 'Microsoft Visual C++ 2015-2022 Redistributable (x64)' from microsoft.com, then start Ruzivo again."
    ${EndIf}
  ${EndIf}
!macroend
