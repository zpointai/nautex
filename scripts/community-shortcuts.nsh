# Copyright (c) 2026 Zlatin Gorov. SPDX-License-Identifier: AGPL-3.0-only
# Uses Windows COM through the existing NSIS System plugin; no WinShell DLL.
!include LogicLib.nsh
!include Win\COM.nsh
!include Win\Propkey.nsh

!macro Nautex_SetLnkAUMI LINK APPID
  System::Store S
  System::Call 'ole32::CoInitializeEx(p0,i2)i.r9'
  StrCpy $0 0
  !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
  ${If} $0 P<> 0
    StrCpy $1 0
    ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
    ${If} $1 P<> 0
      ${IPersistFile::Load} $1 '("${LINK}",2).r8'
      ${If} $8 >= 0
        StrCpy $2 0
        ${IUnknown::QueryInterface} $0 '("${IID_IPropertyStore}",.r2)'
        ${If} $2 P<> 0
          System::Call '*${SYSSTRUCT_PROPERTYKEY}(${PKEY_AppUserModel_ID})p.r3'
          StrCpy $4 0
          System::Call 'shlwapi::SHStrDupW(w"${APPID}",*p.r4)i.r8'
          ${If} $8 >= 0
            System::Call '*${SYSSTRUCT_PROPVARIANT}(${VT_LPWSTR},,p r4)p.r5'
            ${IPropertyStore::SetValue} $2 '(r3,r5).r8'
            ${If} $8 >= 0
              ${IPropertyStore::Commit} $2 '().r8'
              ${If} $8 >= 0
                ${IPersistFile::Save} $1 '("${LINK}",1).r8'
              ${EndIf}
            ${EndIf}
            System::Call 'ole32::PropVariantClear(p r5)'
            System::Free $5
          ${EndIf}
          System::Free $3
          ${IUnknown::Release} $2 ""
        ${EndIf}
      ${EndIf}
      ${IUnknown::Release} $1 ""
    ${EndIf}
    ${IUnknown::Release} $0 ""
  ${EndIf}
  ${If} $9 >= 0
    System::Call 'ole32::CoUninitialize()'
  ${EndIf}
  System::Store L
!macroend

!macro Nautex_UninstShortcut LINK
  System::Store S
  System::Call 'ole32::CoInitializeEx(p0,i2)i.r9'
  StrCpy $0 0
  !insertmacro ComHlpr_CreateInProcInstance ${CLSID_StartMenuPin} ${IID_IStartMenuPinnedList} r0 ""
  ${If} $0 P<> 0
    StrCpy $1 0
    System::Call 'shell32::SHCreateItemFromParsingName(w"${LINK}",p0,g"{43826d1e-e718-42ee-bc55-a1e261c37bfe}",*p.r1)i.r8'
    ${If} $1 P<> 0
      ${IStartMenuPinnedList::RemoveFromList} $0 '(r1)'
      ${IUnknown::Release} $1 ""
    ${EndIf}
    ${IUnknown::Release} $0 ""
  ${EndIf}
  ${If} $9 >= 0
    System::Call 'ole32::CoUninitialize()'
  ${EndIf}
  System::Store L
!macroend

!macro Nautex_UninstAppUserModelId APPID
  System::Store S
  System::Call 'ole32::CoInitializeEx(p0,i2)i.r9'
  StrCpy $0 0
  # ICustomDestinationList::DeleteList, vtable slot 10.
  System::Call 'ole32::CoCreateInstance(g"{77f10cf0-3db5-4966-b520-b7c54fd35ed6}",p0,i1,g"{6332debf-87b5-4670-90c0-5e57b408a49e}",*p.r0)i.r8'
  ${If} $0 P<> 0
    System::Call '$0->10(w"${APPID}")i.r8'
    ${IUnknown::Release} $0 ""
  ${EndIf}
  StrCpy $0 0
  # IApplicationDestinations::SetAppID and RemoveAllDestinations.
  System::Call 'ole32::CoCreateInstance(g"{86c14003-4d6b-4ef3-a7b4-0506663b2e68}",p0,i1,g"{12337D35-94C6-48A0-BCE7-6A9C69D4D600}",*p.r0)i.r8'
  ${If} $0 P<> 0
    System::Call '$0->3(w"${APPID}")i.r8'
    ${If} $8 >= 0
      System::Call '$0->5()i.r8'
    ${EndIf}
    ${IUnknown::Release} $0 ""
  ${EndIf}
  ${If} $9 >= 0
    System::Call 'ole32::CoUninitialize()'
  ${EndIf}
  System::Store L
!macroend
