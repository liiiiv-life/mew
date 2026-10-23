// One-time elevated installation of Mew's root device. Never used by the host.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <setupapi.h>
#include <newdev.h>
#include <sddl.h>
#include <initguid.h>
#include <devguid.h>
#include <string>
#include <vector>
#include <cstdio>
#include "virtual-display-protocol.h"

static bool ownDevice(HDEVINFO list,SP_DEVINFO_DATA& device) {
    DWORD type=0,size=0;SetupDiGetDeviceRegistryPropertyW(list,&device,SPDRP_HARDWAREID,&type,nullptr,0,&size);
    if(type!=REG_MULTI_SZ || !size || size>65536)return false;
    std::vector<wchar_t> value(size/2+2,0);
    if(!SetupDiGetDeviceRegistryPropertyW(list,&device,SPDRP_HARDWAREID,&type,reinterpret_cast<BYTE*>(value.data()),size,nullptr))return false;
    for(auto p=value.data();*p;p+=wcslen(p)+1)if(!_wcsicmp(p,mewDisplayHardwareId))return true;
    return false;
}
int wmain(int count,wchar_t** args) {
    bool remove=count==2 && !_wcsicmp(args[1],L"remove");
    if(!remove && count!=3){fwprintf(stderr,L"Usage: mew-display-install.exe <signed inf> <user SID> | remove\n");return 2;}
    std::wstring security;
    if(!remove) {
        PSID sid=nullptr;if(!ConvertStringSidToSidW(args[2],&sid))return 3;
        wchar_t name[256],domain[256];DWORD n=256,d=256;SID_NAME_USE kind;
        bool valid=LookupAccountSidW(nullptr,sid,name,&n,domain,&d,&kind) && kind==SidTypeUser;
        LocalFree(sid);if(!valid){fwprintf(stderr,L"The SID must identify an existing Windows user, not a group.\n");return 3;}
        security=L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;"+std::wstring(args[2])+L")";
        PSECURITY_DESCRIPTOR descriptor=nullptr;
        if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(security.c_str(),SDDL_REVISION_1,&descriptor,nullptr))return 3;
        LocalFree(descriptor);
    }
    HDEVINFO list=SetupDiGetClassDevsW(&GUID_DEVCLASS_DISPLAY,nullptr,nullptr,DIGCF_PRESENT);
    if(list==INVALID_HANDLE_VALUE)return 4;
    SP_DEVINFO_DATA device{};device.cbSize=sizeof(device);bool found=false;
    for(DWORD i=0;SetupDiEnumDeviceInfo(list,i,&device);i++)if(ownDevice(list,device)){found=true;break;}
    if(remove) {
        bool ok=!found || SetupDiCallClassInstaller(DIF_REMOVE,list,&device);
        DWORD error=ok?0:GetLastError();SetupDiDestroyDeviceInfoList(list);
        if(error)fwprintf(stderr,L"Remove failed: %lu\n",error);return error?5:0;
    }
    bool created=false;
    if(!found) {
        if(!SetupDiCreateDeviceInfoW(list,L"MewVirtualDisplay",&GUID_DEVCLASS_DISPLAY,L"Mew Virtual Display",nullptr,DICD_GENERATE_ID,&device)) {
            SetupDiDestroyDeviceInfoList(list);return 6;
        }
        std::wstring hardware=mewDisplayHardwareId;hardware.push_back(0);
        if(!SetupDiSetDeviceRegistryPropertyW(list,&device,SPDRP_HARDWAREID,reinterpret_cast<const BYTE*>(hardware.c_str()),static_cast<DWORD>((hardware.size()+1)*2)) ||
            !SetupDiCallClassInstaller(DIF_REGISTERDEVICE,list,&device)){SetupDiDestroyDeviceInfoList(list);return 7;}
        created=true;
    }
    BOOL reboot=FALSE;
    bool ok=UpdateDriverForPlugAndPlayDevicesW(nullptr,mewDisplayHardwareId,args[1],INSTALLFLAG_FORCE,&reboot)!=FALSE;
    if(ok)ok=SetupDiSetDeviceRegistryPropertyW(list,&device,SPDRP_SECURITY_SDS,reinterpret_cast<const BYTE*>(security.c_str()),static_cast<DWORD>((security.size()+1)*2))!=FALSE;
    if(ok) {
        SP_PROPCHANGE_PARAMS change{};change.ClassInstallHeader.cbSize=sizeof(change.ClassInstallHeader);
        change.ClassInstallHeader.InstallFunction=DIF_PROPERTYCHANGE;change.StateChange=DICS_PROPCHANGE;change.Scope=DICS_FLAG_CONFIGSPECIFIC;
        ok=SetupDiSetClassInstallParamsW(list,&device,&change.ClassInstallHeader,sizeof(change)) && SetupDiCallClassInstaller(DIF_PROPERTYCHANGE,list,&device);
    }
    DWORD error=ok?0:GetLastError();
    // A failed fresh setup leaves no permissive or partially configured device.
    if(!ok && created)SetupDiCallClassInstaller(DIF_REMOVE,list,&device);
    SetupDiDestroyDeviceInfoList(list);
    if(error){fwprintf(stderr,L"Installation failed: %lu\n",error);return 8;}
    wprintf(L"Mew Virtual Display installed for %s. No monitor is active until an authorized connection selects it.\n",args[2]);
    if(reboot){wprintf(L"Windows requested a reboot; restart Windows before testing.\n");return 3010;}
    return 0;
}
